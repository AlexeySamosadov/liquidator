/**
 * GMX Position Tracker
 * Tracks all open GMX positions and identifies liquidatable ones
 */

import { GMXContracts } from '../../contracts/GMXContracts';
import { GMXPositionCalculator } from './GMXPositionCalculator';
import { Address, GMXPositionInfo, GMXLiquidatablePosition, LowercaseAddress } from '../../types';
import { Market, MarketPrices, PositionStruct } from '../../contracts/interfaces/IGMXReader';
import { logger } from '../../utils/logger';
import { solidityPackedKeccak256, ethers } from 'ethers';

/**
 * GMXPositionTracker manages all tracked positions
 */
export class GMXPositionTracker {
  // Map: positionKey -> GMXPositionInfo
  private positions: Map<string, GMXPositionInfo> = new Map();

  // Map: account -> Set<positionKey>
  private accountPositions: Map<LowercaseAddress, Set<string>> = new Map();

  // Set of accounts that have been discovered
  private discoveredAccounts: Set<LowercaseAddress> = new Set();

  private readonly calculator: GMXPositionCalculator;

  constructor(
    private readonly gmxContracts: GMXContracts,
    private readonly minHealthFactor: number = 1.5
  ) {
    this.calculator = new GMXPositionCalculator(gmxContracts);
  }

  /**
   * Track a new account
   */
  trackAccount(account: Address): void {
    const accountLower = account.toLowerCase() as LowercaseAddress;

    if (!this.discoveredAccounts.has(accountLower)) {
      this.discoveredAccounts.add(accountLower);
      logger.debug('New account discovered', { account, totalAccounts: this.discoveredAccounts.size });
    }
  }

  /**
   * Get position key from account, market, and collateral token
   * PositionKey = keccak256(account, market, collateralToken, isLong)
   */
  getPositionKey(
    account: Address,
    market: Address,
    collateralToken: Address,
    isLong: boolean
  ): string {
    // GMX uses solidityPackedKeccak256 for position keys
    return solidityPackedKeccak256(
      ['address', 'address', 'address', 'bool'],
      [account, market, collateralToken, isLong]
    );
  }

  /**
   * Update position data
   */
  async updatePosition(
    account: Address,
    market: Market,
    prices: MarketPrices
  ): Promise<GMXPositionInfo | null> {
    try {
      const reader = this.gmxContracts.getReader();
      const dataStore = this.gmxContracts.getDataStoreAddress();
      const referralStorage = this.gmxContracts.getReferralStorageAddress();

      // Get account positions for this market
      const positionKeys = await this.gmxContracts.getAccountPositionKeys(account);

      if (positionKeys.length === 0) {
        return null;
      }

      // Get position info for first position (for now)
      const positionKey = positionKeys[0];

      const positionInfo = await reader.getPositionInfo(
        dataStore,
        referralStorage,
        positionKey,
        prices,
        0n, // sizeDeltaUsd
        account, // uiFeeReceiver
        false // usePositionSizeAsSizeDeltaUsd
      );

      // Convert to GMXPositionInfo
      const gmxPositionInfo = this.calculator.toGMXPositionInfo(positionInfo, market);

      // Store position
      this.positions.set(positionKey, gmxPositionInfo);

      // Track account -> position mapping
      const accountLower = account.toLowerCase() as LowercaseAddress;
      if (!this.accountPositions.has(accountLower)) {
        this.accountPositions.set(accountLower, new Set());
      }
      this.accountPositions.get(accountLower)!.add(positionKey);

      logger.debug('Updated GMX position', {
        account,
        market: market.marketToken,
        positionKey,
        healthFactor: gmxPositionInfo.healthFactor.toFixed(4),
        leverage: gmxPositionInfo.leverage.toFixed(2),
        sizeUsd: gmxPositionInfo.sizeValueUsd.toFixed(2),
      });

      return gmxPositionInfo;
    } catch (error) {
      logger.error('Failed to update position', { account, market: market.marketToken, error });
      return null;
    }
  }

  /**
   * Fetch positions directly from the blockchain for an account
   * This provides the ground truth for position data
   */
  async fetchAccountPositionsOnChain(account: Address): Promise<PositionStruct[]> {
    try {
      const reader = this.gmxContracts.getReader();
      const dataStore = this.gmxContracts.getDataStoreAddress();

      // Checksum the account address
      const checksumAccount = ethers.getAddress(account);

      logger.debug('Fetching on-chain positions', { account: checksumAccount, dataStore });

      // Call getAccountPositions with start=0, end=100 (max positions per account)
      const positions = await reader.getAccountPositions(
        dataStore,
        checksumAccount,
        0n,
        100n
      );

      logger.debug('Fetched on-chain positions', {
        account: checksumAccount,
        count: positions.length
      });

      return positions;
    } catch (error) {
      logger.error('Failed to fetch on-chain positions', { account, error });
      return [];
    }
  }

  /**
   * Get all positions for an account
   */
  getAccountPositions(account: Address): GMXPositionInfo[] {
    const accountLower = account.toLowerCase() as LowercaseAddress;
    const positionKeys = this.accountPositions.get(accountLower);

    if (!positionKeys || positionKeys.size === 0) {
      return [];
    }

    const positions: GMXPositionInfo[] = [];
    for (const key of positionKeys) {
      const position = this.positions.get(key);
      if (position) {
        positions.push(position);
      }
    }

    return positions;
  }

  /**
   * Get all liquidatable positions
   */
  getLiquidatablePositions(minProfitUsd: number = 1): GMXLiquidatablePosition[] {
    const liquidatable: GMXLiquidatablePosition[] = [];

    for (const [, position] of this.positions) {
      // Check if position health factor is below threshold
      if (position.healthFactor < this.minHealthFactor) {
        const estimatedProfit = this.calculator.estimateLiquidationProfit(position);

        // Only include if profitable
        if (estimatedProfit >= minProfitUsd) {
          const liquidatablePosition = this.calculator.toLiquidatablePosition(
            position,
            estimatedProfit
          );
          liquidatable.push(liquidatablePosition);
        }
      }
    }

    // Sort by estimated profit (highest first)
    liquidatable.sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);

    return liquidatable;
  }

  /**
   * Get all tracked positions
   */
  getAllPositions(): GMXPositionInfo[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position by key
   */
  getPosition(positionKey: string): GMXPositionInfo | undefined {
    return this.positions.get(positionKey);
  }

  /**
   * Remove position (when closed)
   */
  removePosition(positionKey: string): void {
    const position = this.positions.get(positionKey);
    if (position) {
      const accountLower = position.position.account.toLowerCase() as LowercaseAddress;
      const accountPositions = this.accountPositions.get(accountLower);

      if (accountPositions) {
        accountPositions.delete(positionKey);

        if (accountPositions.size === 0) {
          this.accountPositions.delete(accountLower);
        }
      }

      this.positions.delete(positionKey);
      logger.debug('Removed position', { positionKey, account: position.position.account });
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const allPositions = this.getAllPositions();
    const liquidatable = this.getLiquidatablePositions();

    const totalHealthFactor = allPositions.reduce((sum, p) => sum + p.healthFactor, 0);
    const avgHealthFactor = allPositions.length > 0
      ? totalHealthFactor / allPositions.length
      : 0;

    return {
      totalAccountsTracked: this.discoveredAccounts.size,
      totalPositions: allPositions.length,
      liquidatablePositions: liquidatable.length,
      averageHealthFactor: avgHealthFactor,
      highRiskPositions: allPositions.filter(p => p.healthFactor < 1.2).length,
      mediumRiskPositions: allPositions.filter(p => p.healthFactor >= 1.2 && p.healthFactor < 1.5).length,
      safePositions: allPositions.filter(p => p.healthFactor >= 1.5).length,
    };
  }

  /**
   * Clear all positions (for testing)
   */
  clear(): void {
    this.positions.clear();
    this.accountPositions.clear();
    this.discoveredAccounts.clear();
    logger.info('Cleared all tracked positions');
  }

  /**
   * Get total number of tracked accounts
   */
  getTrackedAccountCount(): number {
    return this.discoveredAccounts.size;
  }

  /**
   * Get all tracked accounts
   */
  getTrackedAccounts(): Address[] {
    return Array.from(this.discoveredAccounts);
  }
}

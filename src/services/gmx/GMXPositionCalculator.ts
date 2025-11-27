/**
 * GMX Position Calculator
 * Calculates health factors, liquidation prices, and profitability for GMX V2 positions
 */

import { GMXContracts } from '../../contracts/GMXContracts';
import { GMXPositionInfo, GMXLiquidatablePosition, Address } from '../../types';
import { PositionInfo, Market, MarketPrices } from '../../contracts/interfaces/IGMXReader';
import { logger } from '../../utils/logger';
// import { solidityPackedKeccak256 } from 'ethers';

const PRECISION = 10n ** 30n;
const BASIS_POINTS = 10000n;

/**
 * GMXPositionCalculator handles all calculations for GMX positions
 */
export class GMXPositionCalculator {
  constructor(private readonly gmxContracts: GMXContracts) { }

  /**
   * Calculate health factor for a position
   * Health Factor = Remaining Collateral / Minimum Required Collateral
   * HF < 1.0 = liquidatable
   */
  calculateHealthFactor(positionInfo: PositionInfo): number {
    try {
      const { position, fees } = positionInfo;

      // Calculate remaining collateral after fees
      const totalFeesInCollateralToken = fees.totalCostAmount;
      const remainingCollateral = position.collateralAmount > totalFeesInCollateralToken
        ? position.collateralAmount - totalFeesInCollateralToken
        : 0n;

      // Get collateral value in USD
      const collateralPriceUsd = fees.collateralTokenPrice.min;
      const collateralValueUsd = (remainingCollateral * collateralPriceUsd) / PRECISION;

      // Calculate leverage
      const leverage = position.sizeInUsd > 0n
        ? Number(position.sizeInUsd) / Number(collateralValueUsd)
        : 0;

      // For GMX, maintenance margin is typically 0.5-1% of position size
      // This is a simplified calculation - actual value comes from market config
      const maintenanceMarginBps = 100n; // 1% = 100 basis points
      const minCollateralUsd = (position.sizeInUsd * maintenanceMarginBps) / BASIS_POINTS;

      // Health Factor = Collateral / Min Required Collateral
      const healthFactor = minCollateralUsd > 0n
        ? Number(collateralValueUsd) / Number(minCollateralUsd)
        : Number.POSITIVE_INFINITY;

      logger.debug('Calculated GMX health factor', {
        account: position.account,
        market: position.market,
        healthFactor: healthFactor.toFixed(4),
        leverage: leverage.toFixed(2),
        collateralValueUsd: Number(collateralValueUsd) / Number(PRECISION),
        positionSizeUsd: Number(position.sizeInUsd) / Number(PRECISION),
        isLiquidatable: healthFactor < 1.0,
      });

      return healthFactor;
    } catch (error) {
      logger.error('Failed to calculate health factor', {
        account: positionInfo.position.account,
        error,
      });
      return Number.POSITIVE_INFINITY;
    }
  }

  /**
   * Calculate liquidation price for a position
   */
  calculateLiquidationPrice(positionInfo: PositionInfo): number {
    try {
      const { position, fees } = positionInfo;

      if (position.sizeInTokens === 0n) {
        return 0;
      }

      const totalFeesInCollateralToken = fees.totalCostAmount;
      const remainingCollateral = position.collateralAmount > totalFeesInCollateralToken
        ? position.collateralAmount - totalFeesInCollateralToken
        : 0n;

      const collateralPriceUsd = fees.collateralTokenPrice.min;
      const collateralValueUsd = (remainingCollateral * collateralPriceUsd) / PRECISION;

      // Maintenance margin (1% of position size)
      const maintenanceMarginBps = 100n;
      const minCollateralUsd = (position.sizeInUsd * maintenanceMarginBps) / BASIS_POINTS;

      // Calculate how much price can move before liquidation
      const maxLossBeforeLiquidation = collateralValueUsd > minCollateralUsd
        ? collateralValueUsd - minCollateralUsd
        : 0n;

      // For LONG: liquidation when price drops
      // For SHORT: liquidation when price rises
      const currentPrice = Number(position.sizeInUsd) / Number(position.sizeInTokens);
      const priceMove = Number(maxLossBeforeLiquidation) / Number(position.sizeInTokens);

      const liquidationPrice = position.isLong
        ? currentPrice - priceMove
        : currentPrice + priceMove;

      logger.debug('Calculated liquidation price', {
        account: position.account,
        isLong: position.isLong,
        currentPrice,
        liquidationPrice,
        priceMove,
        percentToLiquidation: (Math.abs(priceMove) / currentPrice * 100).toFixed(2) + '%',
      });

      return liquidationPrice;
    } catch (error) {
      logger.error('Failed to calculate liquidation price', {
        account: positionInfo.position.account,
        error,
      });
      return 0;
    }
  }

  /**
   * Convert position info to GMXPositionInfo type
   */
  toGMXPositionInfo(
    positionInfo: PositionInfo,
    market: Market
  ): GMXPositionInfo {
    const healthFactor = this.calculateHealthFactor(positionInfo);
    const liquidationPrice = this.calculateLiquidationPrice(positionInfo);

    const collateralValueUsd = Number(positionInfo.position.collateralAmount * positionInfo.fees.collateralTokenPrice.min) / Number(PRECISION * PRECISION);
    const sizeValueUsd = Number(positionInfo.position.sizeInUsd) / Number(PRECISION);
    const leverage = collateralValueUsd > 0 ? sizeValueUsd / collateralValueUsd : 0;
    const unrealizedPnlUsd = Number(positionInfo.basePnlUsd) / Number(PRECISION);

    return {
      position: {
        account: positionInfo.position.account,
        market: positionInfo.position.market,
        collateralToken: positionInfo.position.collateralToken,
        isLong: positionInfo.position.isLong,
        sizeInUsd: positionInfo.position.sizeInUsd,
        sizeInTokens: positionInfo.position.sizeInTokens,
        collateralAmount: positionInfo.position.collateralAmount,
        borrowingFactor: positionInfo.position.borrowingFactor,
        fundingFeeAmountPerSize: positionInfo.position.fundingFeeAmountPerSize,
        longTokenClaimableFundingAmountPerSize: positionInfo.position.longTokenClaimableFundingAmountPerSize,
        shortTokenClaimableFundingAmountPerSize: positionInfo.position.shortTokenClaimableFundingAmountPerSize,
        increasedAtBlock: positionInfo.position.increasedAtBlock,
        decreasedAtBlock: positionInfo.position.decreasedAtBlock,
      },
      marketInfo: {
        marketToken: market.marketToken,
        indexToken: market.indexToken,
        longToken: market.longToken,
        shortToken: market.shortToken,
        marketName: `${market.indexToken.substring(0, 6)}...`,
      },
      collateralValueUsd,
      sizeValueUsd,
      leverage,
      liquidationPrice,
      unrealizedPnlUsd,
      healthFactor,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Check if position is liquidatable
   */
  async isPositionLiquidatable(
    positionKey: string,
    market: Market,
    prices: MarketPrices
  ): Promise<boolean> {
    try {
      const reader = this.gmxContracts.getReader();
      const dataStore = this.gmxContracts.getDataStoreAddress();
      const referralStorage = this.gmxContracts.getReferralStorageAddress();

      const [isLiquidatable, reason, info] = await reader.isPositionLiquidatable(
        dataStore,
        referralStorage,
        positionKey,
        market,
        prices,
        true // shouldValidateMinCollateralUsd
      );

      if (isLiquidatable) {
        logger.info('Position is liquidatable', {
          positionKey,
          reason,
          minCollateralUsd: Number(info.minCollateralUsd) / Number(PRECISION),
          collateralUsd: Number(info.collateralUsd) / Number(PRECISION),
        });
      }

      return isLiquidatable;
    } catch (error) {
      logger.error('Failed to check if position is liquidatable', {
        positionKey,
        error,
      });
      return false;
    }
  }

  /**
   * Estimate liquidation profit
   * GMX liquidators receive 5% of position size as reward
   */
  estimateLiquidationProfit(positionInfo: GMXPositionInfo): number {
    // GMX liquidation reward is typically 5% of position size
    const LIQUIDATION_REWARD_BPS = 500n; // 5% = 500 basis points
    const positionSizeUsd = Number(positionInfo.position.sizeInUsd) / Number(PRECISION);
    const rewardUsd = (positionSizeUsd * Number(LIQUIDATION_REWARD_BPS)) / Number(BASIS_POINTS);

    // Subtract estimated gas cost (Arbitrum gas is very cheap)
    const estimatedGasCostUsd = 0.02; // ~$0.02 on Arbitrum

    const netProfitUsd = rewardUsd - estimatedGasCostUsd;

    logger.debug('Estimated liquidation profit', {
      account: positionInfo.position.account,
      positionSizeUsd,
      rewardUsd,
      estimatedGasCostUsd,
      netProfitUsd,
    });

    return netProfitUsd;
  }

  /**
   * Convert GMXPositionInfo to GMXLiquidatablePosition
   */
  toLiquidatablePosition(
    positionInfo: GMXPositionInfo,
    estimatedProfitUsd: number,
    gasEstimate: bigint = 300000n
  ): GMXLiquidatablePosition {
    return {
      ...positionInfo,
      estimatedProfitUsd,
      gasEstimate,
    };
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
    const { keccak256, AbiCoder } = require('ethers');
    return keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'address', 'bool'],
        [account, market, collateralToken, isLong]
      )
    );
  }

  /**
   * Get mock prices for testing (in production, these come from Chainlink oracles)
   */
  getMockPrices(indexTokenPrice: number): MarketPrices {
    const priceInPrecision = BigInt(Math.floor(indexTokenPrice * Number(PRECISION)));

    return {
      indexTokenPrice: {
        min: priceInPrecision,
        max: priceInPrecision,
      },
      longTokenPrice: {
        min: priceInPrecision,
        max: priceInPrecision,
      },
      shortTokenPrice: {
        min: priceInPrecision,
        max: priceInPrecision,
      },
    };
  }
}

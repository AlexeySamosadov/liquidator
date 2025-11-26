import { Address } from '../../types';
import { logger } from '../../utils/logger';
import VenusContracts from '../../contracts';
import HealthFactorCalculator from '../monitoring/HealthFactorCalculator';
import { JsonRpcProvider } from 'ethers';

export interface PositionSnapshot {
  account: Address;
  totalCollateralUsd: number;
  totalBorrowUsd: number;
  healthFactor: number;
  lastUpdated: number;
}

export interface SnapshotConfig {
  enabled: boolean;
  snapshotFile?: string;
  externalApiUrl?: string;
  updateIntervalMs: number;
  minPositionSizeUsd: number;
  topNPositions: number;
}

class SnapshotService {
  private positions: PositionSnapshot[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastUpdateTime = 0;

  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly healthFactorCalculator: HealthFactorCalculator,
    private readonly onPositionDiscovered: (account: Address) => Promise<void>,
    private readonly config: SnapshotConfig,
    private readonly provider: JsonRpcProvider,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    logger.info('Snapshot service starting', { config: this.config });

    // Initial load
    await this.loadAndUpdatePositions();

    // Set up periodic updates
    if (this.config.enabled) {
      this.intervalId = setInterval(() => {
        this.loadAndUpdatePositions().catch((error) => {
          logger.warn('Periodic snapshot update failed', { error });
        });
      }, this.config.updateIntervalMs);
    }

    this.isRunning = true;
    logger.info('Snapshot service started');
  }

  stop(): void {
    if (!this.isRunning) return;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    logger.info('Snapshot service stopped');
  }

  async addManualSnapshot(account: Address): Promise<void> {
    try {
      const position = await this.healthFactorCalculator.getPositionDetails(account);

      const snapshot: PositionSnapshot = {
        account: account.toLowerCase(),
        totalCollateralUsd: position.collateralValueUsd,
        totalBorrowUsd: position.debtValueUsd,
        healthFactor: position.healthFactor,
        lastUpdated: Date.now(),
      };

      // Update or add to local cache
      const existingIndex = this.positions.findIndex(p => p.account === account.toLowerCase());
      if (existingIndex >= 0) {
        this.positions[existingIndex] = snapshot;
      } else {
        this.positions.push(snapshot);
      }

      logger.debug('Added manual snapshot', {
        account,
        healthFactor: position.healthFactor,
        debtUsd: position.debtValueUsd,
        collateralUsd: position.collateralValueUsd,
      });

      // Add to monitoring queue
      await this.onPositionDiscovered(account);

    } catch (error) {
      logger.warn('Failed to get snapshot for account', { account, error });
    }
  }

  private async loadAndUpdatePositions(): Promise<void> {
    logger.info('Loading position snapshots');

    const startTime = Date.now();
    let newPositionsCount = 0;
    let updatedPositionsCount = 0;

    try {
      // For now, implement basic positions scanning
      // This would integrate with external APIs like DefiLlama in production

      if (this.config.snapshotFile) {
        await this.loadFromFile();
      } else {
        // Do basic market scan for major borrowers
        await this.scanMajorBorrowers();
      }

      // Update position details
      const positionsToUpdate = this.positions.filter(p =>
        p.totalBorrowUsd >= this.config.minPositionSizeUsd &&
        (p.healthFactor < 1.2 || (Date.now() - p.lastUpdated) > 600000) // Update if older than 10 min or HF low
      );

      for (const position of positionsToUpdate) {
        try {
          await this.onPositionDiscovered(position.account);
          updatedPositionsCount++;
        } catch (error) {
          logger.warn('Failed to update position snapshot', {
            account: position.account,
            error
          });
        }
      }

      this.lastUpdateTime = Date.now();

      logger.info('Position snapshots updated', {
        totalPositions: this.positions.length,
        updatedPositions: updatedPositionsCount,
        newPositions: newPositionsCount,
        durationMs: Date.now() - startTime,
      });

    } catch (error) {
      logger.error('Failed to load position snapshots', { error });
    }
  }

  private async scanMajorBorrowers(): Promise<void> {
    // Scan major markets for borrowers positions
    const markets = await this.venusContracts.getAllVTokens();
    const majorBorrowers = new Set<Address>();

    logger.info('Scanning markets for major borrowers', { marketCount: markets.length });

    for (const market of markets.slice(0, 20)) { // Top 20 markets only for now
      try {
        const vToken = this.venusContracts.getVToken(market);

        // Get current block for recent events only (reduce load)
        const currentBlock = await this.provider.getBlockNumber();
        const fromBlock = Math.max(currentBlock - 28800, 1); // Last ~1 day (28800 blocks is about 1 day BNB)

        // Look for recent borrowing/repayment activity
        const events = await Promise.all([
          this.getEvents(vToken, vToken.filters.Borrow(), fromBlock, currentBlock),
          this.getEvents(vToken, vToken.filters.RepayBorrow(), fromBlock, currentBlock),
        ]);

        // Extract borrowers from events
        const borrowers = events.flat().map((event: any) => {
          const eventName = event.eventName;
          if (eventName === 'Borrow') return event.args?.[0];
          if (eventName === 'RepayBorrow') return event.args?.[1];
          return null;
        }).filter((addr): addr is Address => addr && addr !== null);

        borrowers.forEach(addr => majorBorrowers.add(addr.toLowerCase()));

      } catch (error) {
        logger.warn('Failed to scan market', { market, error });
      }
    }

    logger.info('Discovered major borrowers', {
      uniqueAccounts: majorBorrowers.size,
      totalMarketsScanned: Math.min(markets.length, 20)
    });

    // Add major borrowers to monitoring queue
    let addedCount = 0;
    for (const account of majorBorrowers) {
      try {
        await this.onPositionDiscovered(account);
        addedCount++;
      } catch (error) {
        logger.warn('Failed to add discovered account', { account, error });
      }
    }

    logger.info('Added major borrowers to monitoring queue', {
      addedCount,
      totalDiscovered: majorBorrowers.size
    });
  }

  private async getEvents(
    vToken: any,
    filter: any,
    fromBlock: number,
    toBlock: number
  ): Promise<any[]> {
    try {
      const windowSize = 1000; // Poll in windows to avoid RPC limits
      const events = [];

      for (let start = fromBlock; start <= toBlock; start += windowSize) {
        const end = Math.min(start + windowSize - 1, toBlock);
        const chunk = await vToken.queryFilter(filter, start, end);
        events.push(...chunk);
      }

      return events.slice(-50); // Take only last 50 events to avoid too much data
    } catch (error) {
      logger.warn('Failed to get events from market', {
        filter: filter.toString(),
        error
      });
      return [];
    }
  }

  private async loadFromFile(): Promise<void> {
    if (!this.config.snapshotFile) return;

    try {
      const fs = require('fs');
      const data = fs.readFileSync(this.config.snapshotFile, 'utf8');
      const addresses = data.split('\n').filter((line: string) => line.trim()); // One address per line

      logger.info('Loading accounts from snapshot file', {
        file: this.config.snapshotFile,
        totalAddresses: addresses.length
      });

      for (const account of addresses) {
        if (account.length === 42 && account.startsWith('0x')) {
          try {
            await this.addManualSnapshot(account);
          } catch (error) {
            logger.warn('Failed to add snapshot from file', { account, error });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load snapshot file', {
        file: this.config.snapshotFile,
        error
      });
    }
  }

  getStats() {
    const positionsUnderwater = this.positions.filter(p => p.healthFactor < 1.0);
    const positionsAtRisk = this.positions.filter(p => p.healthFactor < 1.2 && p.healthFactor >= 1.0);

    return {
      totalPositions: this.positions.length,
      positionsUnderwater: positionsUnderwater.length,
      positionsAtRisk: positionsAtRisk.length,
      lastUpdateTime: this.lastUpdateTime,
      avgBorrowSize: this.positions.reduce((sum, p) => sum + p.totalBorrowUsd, 0) / Math.max(this.positions.length, 1),
      totalBorrowUsd: this.positions.reduce((sum, p) => sum + p.totalBorrowUsd, 0),
      totalCollateralUsd: this.positions.reduce((sum, p) => sum + p.totalCollateralUsd, 0),
    };
  }
}

export default SnapshotService;
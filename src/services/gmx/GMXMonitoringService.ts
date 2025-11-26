/**
 * GMX Monitoring Service
 * Main service for monitoring GMX positions and detecting liquidation opportunities
 */

import { GMXContracts } from '../../contracts/GMXContracts';
import { GMXPositionTracker } from './GMXPositionTracker';
import { GMXPositionCalculator } from './GMXPositionCalculator';
import { Address, GMXLiquidatablePosition, BotConfig } from '../../types';
import { Market, MarketPrices } from '../../contracts/interfaces/IGMXReader';
import { logger } from '../../utils/logger';

export interface GMXMonitoringStats {
  totalAccountsTracked: number;
  totalPositions: number;
  liquidatablePositions: number;
  highRiskPositions: number;
  mediumRiskPositions: number;
  safePositions: number;
  averageHealthFactor: number;
  lastPollTimestamp: number;
  marketsMonitored: number;
}

/**
 * GMXMonitoringService coordinates position monitoring and liquidation detection
 */
export class GMXMonitoringService {
  private readonly positionTracker: GMXPositionTracker;
  private readonly calculator: GMXPositionCalculator;
  private isRunning = false;
  private pollingInterval?: NodeJS.Timeout;
  private lastPollTime = 0;
  private markets: Market[] = [];

  constructor(
    private readonly gmxContracts: GMXContracts,
    private readonly config: BotConfig,
    private readonly onLiquidatableFound?: (position: GMXLiquidatablePosition) => void
  ) {
    this.positionTracker = new GMXPositionTracker(
      gmxContracts,
      config.minHealthFactor
    );
    this.calculator = new GMXPositionCalculator(gmxContracts);

    logger.info('GMXMonitoringService initialized', {
      minHealthFactor: config.minHealthFactor,
      pollingIntervalMs: config.pollingIntervalMs,
    });
  }

  /**
   * Start monitoring GMX positions
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('GMX monitoring already running');
      return;
    }

    logger.info('Starting GMX position monitoring...');
    this.isRunning = true;

    try {
      // Load all markets
      await this.loadMarkets();

      // Start polling loop
      this.pollingInterval = setInterval(
        () => this.pollPositions(),
        this.config.pollingIntervalMs
      );

      // Do initial poll
      await this.pollPositions();

      logger.info('✅ GMX monitoring started successfully', {
        marketsMonitored: this.markets.length,
        pollingIntervalMs: this.config.pollingIntervalMs,
      });
    } catch (error) {
      logger.error('Failed to start GMX monitoring', { error });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping GMX monitoring...');
    this.isRunning = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    logger.info('✅ GMX monitoring stopped');
  }

  /**
   * Load all GMX markets
   */
  private async loadMarkets(): Promise<void> {
    try {
      logger.info('Loading GMX markets...');

      const marketAddresses = await this.gmxContracts.getAllMarkets();
      const reader = this.gmxContracts.getReader();
      const dataStore = this.gmxContracts.getDataStoreAddress();

      this.markets = [];

      for (const marketAddress of marketAddresses) {
        try {
          const market = await reader.getMarket(dataStore, marketAddress);
          this.markets.push(market);
        } catch (error) {
          logger.warn('Failed to load market', { marketAddress, error });
        }
      }

      logger.info(`✅ Loaded ${this.markets.length} GMX markets`);
    } catch (error) {
      logger.error('Failed to load markets', { error });
      throw error;
    }
  }

  /**
   * Poll all positions across all markets
   */
  private async pollPositions(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const startTime = Date.now();
    logger.debug('Polling GMX positions...', { markets: this.markets.length });

    try {
      // For now, we'll poll a sample of known active traders
      // In production, you'd get this from events or subgraph
      const sampleAccounts = this.getSampleAccounts();

      for (const account of sampleAccounts) {
        for (const market of this.markets) {
          try {
            // Get mock prices (in production, use Chainlink oracle)
            const prices = this.getMockMarketPrices(market);

            // Update position
            await this.positionTracker.updatePosition(account, market, prices);
          } catch (error) {
            // Position might not exist for this account/market combo
            logger.debug('No position for account/market', {
              account,
              market: market.marketToken,
            });
          }
        }
      }

      // Check for liquidatable positions
      const liquidatable = this.positionTracker.getLiquidatablePositions(
        this.config.minProfitUsd
      );

      if (liquidatable.length > 0) {
        logger.info(`🎯 Found ${liquidatable.length} liquidatable GMX positions!`);

        for (const position of liquidatable) {
          logger.info('Liquidatable position found', {
            account: position.position.account,
            market: position.marketInfo.marketToken,
            healthFactor: position.healthFactor.toFixed(4),
            estimatedProfit: position.estimatedProfitUsd.toFixed(2),
            leverage: position.leverage.toFixed(2),
            sizeUsd: position.sizeValueUsd.toFixed(2),
          });

          // Notify callback
          if (this.onLiquidatableFound) {
            this.onLiquidatableFound(position);
          }
        }
      }

      this.lastPollTime = Date.now();
      const duration = this.lastPollTime - startTime;

      logger.debug('GMX poll completed', {
        duration: `${duration}ms`,
        positions: this.positionTracker.getAllPositions().length,
        liquidatable: liquidatable.length,
      });
    } catch (error) {
      logger.error('Failed to poll positions', { error });
    }
  }

  /**
   * Get sample accounts for testing
   * In production, discover accounts from events or subgraph
   */
  private getSampleAccounts(): Address[] {
    // These would come from monitoring PositionIncrease/PositionDecrease events
    // or from a subgraph query
    return [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ];
  }

  /**
   * Get mock market prices for testing
   * In production, fetch from Chainlink Data Streams
   */
  private getMockMarketPrices(_market: Market): MarketPrices {
    // ETH price: $3000
    // BTC price: $60000
    // For testing, use ETH price
    return this.calculator.getMockPrices(3000);
  }

  /**
   * Get monitoring statistics
   */
  getStats(): GMXMonitoringStats {
    const trackerStats = this.positionTracker.getStats();

    return {
      totalAccountsTracked: trackerStats.totalAccountsTracked,
      totalPositions: trackerStats.totalPositions,
      liquidatablePositions: trackerStats.liquidatablePositions,
      highRiskPositions: trackerStats.highRiskPositions,
      mediumRiskPositions: trackerStats.mediumRiskPositions,
      safePositions: trackerStats.safePositions,
      averageHealthFactor: trackerStats.averageHealthFactor,
      lastPollTimestamp: this.lastPollTime,
      marketsMonitored: this.markets.length,
    };
  }

  /**
   * Get all liquidatable positions
   */
  getLiquidatablePositions(): GMXLiquidatablePosition[] {
    return this.positionTracker.getLiquidatablePositions(this.config.minProfitUsd);
  }

  /**
   * Get all positions
   */
  getAllPositions() {
    return this.positionTracker.getAllPositions();
  }

  /**
   * Manual position check (for testing)
   */
  async checkPosition(
    account: Address,
    market: Market,
    prices: MarketPrices
  ) {
    return await this.positionTracker.updatePosition(account, market, prices);
  }

  /**
   * Check if monitoring is running
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }
}

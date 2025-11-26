import { JsonRpcProvider } from 'ethers';
import VenusContracts from '../../contracts';
import { BotConfig, LiquidatablePosition, MonitoringStats, PositionTrackerStats } from '../../types';
import { logger } from '../../utils/logger';
import HealthFactorCalculator from './HealthFactorCalculator';
import EventMonitor from './EventMonitor';
import PollingService from './PollingService';
import PositionTracker from './PositionTracker';
import PriceService from '../pricing/PriceService';
import ProfitabilityCalculator from '../liquidation/ProfitabilityCalculator';

class MonitoringService {
  private healthFactorCalculator!: HealthFactorCalculator;

  private eventMonitor!: EventMonitor;

  private pollingService!: PollingService;

  private positionTracker!: PositionTracker;

  private profitabilityCalculator!: ProfitabilityCalculator;

  private isRunning = false;

  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly provider: JsonRpcProvider,
    private readonly config: BotConfig,
    private readonly priceService: PriceService,
  ) {}

  async initialize(): Promise<void> {
    this.healthFactorCalculator = new HealthFactorCalculator(this.venusContracts);
    this.profitabilityCalculator = new ProfitabilityCalculator(this.config, this.provider, this.priceService);
    this.positionTracker = new PositionTracker(
      this.healthFactorCalculator,
      this.priceService,
      this.config.minHealthFactor,
      this.config.minPositionSizeUsd,
      (position) => this.profitabilityCalculator.estimateGasCostUsdForCandidate(position),
    );

    this.pollingService = new PollingService(
      this.healthFactorCalculator,
      this.config.pollingIntervalMs,
      this.config.minHealthFactor,
      (position) => this.positionTracker.updatePosition(position),
      this.config.healthyPollsBeforeDrop ?? 3,
      this.config.pollingBatchSize ?? 0,
    );

    this.eventMonitor = new EventMonitor(
      this.venusContracts,
      this.provider,
      (account) => this.pollingService.addAccount(account),
      this.config.historicalScanWindowBlocks ?? 200,
    );

    logger.info('Monitoring service initialized');
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    // Быстрый исторический прогрев: соберём активных заёмщиков за последние N блоков
    const currentBlock = await this.provider.getBlockNumber();
    const shouldRunHistoricalScan = this.config.enableHistoricalScan ?? true;
    const historicalDepth = this.config.historicalScanBlocks ?? 4000;
    const historicalWindow = this.config.historicalScanWindowBlocks ?? 200;
    const fromBlock = Math.max(currentBlock - historicalDepth, 1);

    await this.eventMonitor.start();
    if (shouldRunHistoricalScan) {
      try {
        await this.eventMonitor.historicalScan(fromBlock, currentBlock);
      } catch (error) {
        logger.warn('Historical scan failed', { error });
      }
    } else {
      logger.info('Historical scan skipped via configuration flag');
    }

    this.pollingService.start();
    this.isRunning = true;
    logger.info('Monitoring service started', {
      pollingIntervalMs: this.config.pollingIntervalMs,
      minHealthFactor: this.config.minHealthFactor,
      minPositionSizeUsd: this.config.minPositionSizeUsd,
      historicalScanEnabled: shouldRunHistoricalScan,
      historicalScanBlocks: shouldRunHistoricalScan ? historicalDepth : 0,
      historicalScanWindowBlocks: shouldRunHistoricalScan ? historicalWindow : 0,
      historicalAccounts: this.eventMonitor.getHistoricalAccounts(),
    });
  }

  stop(): void {
    if (!this.isRunning) return;

    this.eventMonitor.stop();
    this.pollingService.stop();
    this.isRunning = false;
    logger.info('Monitoring service stopped');
  }

  getLiquidatablePositions(): LiquidatablePosition[] {
    return this.positionTracker.getLiquidatablePositions();
  }

  getStats(): MonitoringStats {
    const trackerStats: PositionTrackerStats = this.positionTracker.getStats();
    const polling = this.pollingService.getStats();
    const rpcTelemetry = this.eventMonitor.getRpcTelemetry();

    return {
      totalAccountsTracked: trackerStats.totalAccountsTracked,
      liquidatablePositions: trackerStats.liquidatablePositions,
      averageHealthFactor: trackerStats.averageHealthFactor,
      lastPollTimestamp: polling.lastPoll,
      eventsProcessed: this.eventMonitor.getEventsProcessed(),
      rpcTelemetry: {
        historicalScan: {
          queryCount: rpcTelemetry.queryCount,
          windowCount: rpcTelemetry.windowCount,
          totalLogs: rpcTelemetry.totalLogs,
        },
        polling: {
          totalPolled: polling.totalPolled,
          pollCount: polling.pollCount,
          failedPolls: polling.failedPolls,
          successfulUpdates: polling.successfulUpdates,
          avgPollDurationMs: polling.avgPollDurationMs,
          avgSuccessRate: polling.avgSuccessRate,
        },
      },
    };
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export default MonitoringService;

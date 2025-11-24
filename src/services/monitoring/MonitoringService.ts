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
    );

    this.eventMonitor = new EventMonitor(
      this.venusContracts,
      this.provider,
      (account) => this.pollingService.addAccount(account),
    );

    logger.info('Monitoring service initialized');
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    await this.eventMonitor.start();
    this.pollingService.start();
    this.isRunning = true;
    logger.info('Monitoring service started', {
      pollingIntervalMs: this.config.pollingIntervalMs,
      minHealthFactor: this.config.minHealthFactor,
      minPositionSizeUsd: this.config.minPositionSizeUsd,
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

    return {
      totalAccountsTracked: trackerStats.totalAccountsTracked,
      liquidatablePositions: trackerStats.liquidatablePositions,
      averageHealthFactor: trackerStats.averageHealthFactor,
      lastPollTimestamp: polling.lastPoll,
      eventsProcessed: this.eventMonitor.getEventsProcessed(),
    };
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export default MonitoringService;

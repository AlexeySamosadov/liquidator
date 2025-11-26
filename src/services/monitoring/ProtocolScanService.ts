import { JsonRpcProvider } from 'ethers';
import VenusContracts from '../../contracts';
import { BotConfig, LiquidatablePosition } from '../../types';
import { logger } from '../../utils/logger';
import HealthFactorCalculator from './HealthFactorCalculator';
import { ProtocolPositionScanner } from '../protocol';
import PositionTracker from './PositionTracker';
import PriceService from '../pricing/PriceService';
import ProfitabilityCalculator from '../liquidation/ProfitabilityCalculator';

class ProtocolScanService {
  private healthFactorCalculator!: HealthFactorCalculator;
  private profitabilityCalculator!: ProfitabilityCalculator;
  private positionTracker!: PositionTracker;
  private protocolScanner!: ProtocolPositionScanner;
  private isRunning = false;
  private statsInterval: NodeJS.Timeout | null = null;

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

    this.protocolScanner = new ProtocolPositionScanner(
      this.venusContracts,
      this.healthFactorCalculator,
      async (scanResult) => {
        // Process discovered position through the existing tracking system
        try {
          const position = await this.healthFactorCalculator.getPositionDetails(scanResult.account);

          // Update position in tracker
          await this.positionTracker.updatePosition(position);

          logger.info("[NEW-SCANNER] Processed liquidatable position scan", {
            account: scanResult.account,
            healthFactor: scanResult.healthFactor,
            isLiquidatable: scanResult.isLiquidatable,
            borrowUsd: scanResult.totalBorrowUsd
          });
        } catch (error) {
          logger.warn("[NEW-SCANNER] Failed to track scanned position", {
            account: scanResult.account,
            error
          });
        }
      },
      {
        scanIntervalMs: this.config.scanIntervalMs ?? 120000, // 2 min - normal procedure
        minHealthFactor: this.config.minHealthFactor,
        minPositionSizeUsd: this.config.minPositionSizeUsd,
        maxScanBatchSize: Math.max(20, this.config.scanBatchSize ?? 20), // Full power capacity
        scanMarketBatch: 25, // Scan up to 25 markets per cycle with proper RPC
        eventWindowBlocks: this.config.scanWindowBlocks ?? 1000, // Normal comprehensive window
        rpcDelayMs: Math.max(50, this.config.rpcDelayMs ?? 50), // Reduced delay for fast RPC
      },
      this.provider,
    );

    logger.info('New protocol-based monitoring service initialized');
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    // Небольшой диагностический блок из defi-аналитика
    const currentBlock = await this.provider.getBlockNumber();
    logger.info('[NEW-SCANNER] Starting protocol scan service', {
      currentBlock,
      minHealthFactor: this.config.minHealthFactor,
      scanInterval: (this.config.pollingIntervalMs ?? 120000) * 6,
    });

    // Запускаем основной протокольный сканнер
    await this.protocolScanner.start();

    // Periodically log statistics
    if (this.config.statsLoggingIntervalMs && this.config.statsLoggingIntervalMs > 0) {
      this.statsInterval = setInterval(() => {
        logger.info("[NEW-SCANNER] Protocol scan statistics", {
          scanStats: this.protocolScanner.getScanStats(),
          trackerStats: this.positionTracker.getStats(),
        });
      }, this.config.statsLoggingIntervalMs);
    }

    this.isRunning = true;
    logger.info('[NEW-SCANNER] Protocol scan monitoring started', {
      scanMode: 'ALL_POSITIONS',
      maxMarketsPerScan: 20,
      minPositionThreshold: this.config.minPositionSizeUsd,
    });
  }

  stop(): void {
    if (!this.isRunning) return;

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.protocolScanner.stop();
    this.isRunning = false;

    logger.info('[NEW-SCANNER] Protocol scan monitoring service stopped');
  }

  getLiquidatablePositions(): LiquidatablePosition[] {
    // Получаем все ликвидаЦИОННые позиции из трекера как и раньше
    return this.positionTracker.getLiquidatablePositions();
  }

  getStats() {
    const trackerStats = this.positionTracker.getStats();
    const scanStats = this.protocolScanner.getScanStats();

    return {
      totalAccountsTracked: trackerStats.totalAccountsTracked,
      liquidatablePositions: trackerStats.liquidatablePositions,
      averageHealthFactor: trackerStats.averageHealthFactor,
      lastPollTimestamp: 0,
      eventsProcessed: 0, // eventsный режим не используются
      scanStats,
    };
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export default ProtocolScanService;
import { Address } from '../../types';
import { logger } from '../../utils/logger';
import VenusContracts from '../../contracts';
import HealthFactorCalculator from '../monitoring/HealthFactorCalculator';
import { JsonRpcProvider } from 'ethers';

export interface PositionScanResult {
  account: Address;
  healthFactor: number;
  totalBorrowUsd: number;
  totalCollateralUsd: number;
  isLiquidatable: boolean;
  markets: {
    borrow: Address[];
    collateral: Address[];
  };
}

export interface ProtocolScannerConfig {
  scanIntervalMs: number;
  minHealthFactor: number;
  minPositionSizeUsd: number;
  maxScanBatchSize: number;
  scanMarketBatch: number;
  eventWindowBlocks: number;
  rpcDelayMs: number;
}

/**
 * Новый сканнер протокола Venus для активного обхода всех позиций.
 * Работает напрямую с контрактами Venus для обнаружения всех борзуйств.
 */
class ProtocolPositionScanner {
  private isRunning = false;
  private scanIntervalId: NodeJS.Timeout | null = null;
  private skippingCache = new Set<Address>(); // пропускаемые по разным причинам

  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly healthFactorCalculator: HealthFactorCalculator,
    private readonly onPositionDiscovered: (position: PositionScanResult) => Promise<void>,
    private readonly config: ProtocolScannerConfig,
    private readonly provider: JsonRpcProvider,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    logger.info('Protocol position scanner starting', {
      config: {
        scanIntervalMs: this.config.scanIntervalMs,
        minHealthFactor: this.config.minHealthFactor,
        minPositionSizeUsd: this.config.minPositionSizeUsd,
        maxScanBatchSize: this.config.maxScanBatchSize,
      }
    });

    // Запускаем начальное сканирование
    await this.scanAllPositions();

    // Schedule periodic scanning
    this.scanIntervalId = setInterval(async () => {
      try {
        await this.scanAllPositions();
      } catch (error) {
        logger.error('Periodic position scan failed', { error });
      }
    }, this.config.scanIntervalMs);

    this.isRunning = true;
    logger.info('Protocol position scanner started');
  }

  stop(): void {
    if (!this.isRunning) return;

    if (this.scanIntervalId) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
    }
    this.isRunning = false;

    logger.info('Protocol position scanner stopped');
  }

  async scanAllPositions(): Promise<number> {
    const startTime = Date.now();
    const allVTokenMarkets = await this.venusContracts.getAllVTokens();
    const totalPositionsFound = new Set<Address>();

    logger.info('[SCAN] Starting full protocol scan', {
      totalMarkets: allVTokenMarkets.length,
      minHealthFactor: this.config.minHealthFactor,
      minPositionSizeUsd: this.config.minPositionSizeUsd
    });

    // Сканирование по блокам рынков снижает нагрузку на RPC
    const marketsToScan = allVTokenMarkets.slice(0, Math.min(allVTokenMarkets.length, this.config.scanMarketBatch));

    const marketsScanned: Address[] = [];
    const positionsSkipped: Address[] = [];

    for (const market of marketsToScan) {
      try {
        // Add delay between market scans to avoid rate limiting
        if (this.config.rpcDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, this.config.rpcDelayMs));
        }
        logger.debug("[SCAN] Scanning market", { market });
        const hasBorrowers = await this.scanMarketForBorrowers(market, totalPositionsFound, positionsSkipped);

        if (hasBorrowers) {
          marketsScanned.push(market);
        }
      } catch (error) {
        logger.warn("[SCAN] Failed to scan market", { market, error });
      }
    }

    // Даем детальную статистику
    logger.info('[SCAN] Protocol scan completed', {
      durationMs: Date.now() - startTime,
      marketsScanned: marketsScanned.length,
      totalPositionsFound: totalPositionsFound.size,
      positionsSkippedInCache: positionsSkipped.length,
      avgProcessingTimePerMarket: Math.round((Date.now() - startTime) / marketsScanned.length),
    });

    return totalPositionsFound.size;
  }

  private async scanMarketForBorrowers(
    marketAddress: Address,
    positionsTotal: Set<Address>,
    positionsSkippedInCache: Address[],
  ): Promise<boolean> {
    const vToken = this.venusContracts.getVToken(marketAddress);

    let hasActiveBorrowers = false;

    try {
      // Узнаём текущий блок чтобы знания из него
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(1, currentBlock - 57600); // ~2 дня назад для актуальных данных

      // Получаем недавние ссудные позиции из событий (компромисс - чтобы не перебрыливать блоки)
      const recentBorrowers = await this.getRecentBorrowersFromEvents(vToken, fromBlock, currentBlock);
      const recentRepayBorrowers = await this.getRecentRepayBorrowersFromEvents(vToken, fromBlock, currentBlock);
      const recentLiquidationBorrowers = await this.getRecentLiquidationBorrowersFromEvents(vToken, fromBlock, currentBlock);

      // Собискadu всех заёмщиков для текущего рынка
      const uniqueBorrowers = new Set([
        ...recentBorrowers,
        ...recentRepayBorrowers,
        ...recentLiquidationBorrowers,
      ]);

      if (uniqueBorrowers.size === 0) return false;

      // Проверяем позиции с симметричного подхода - не может быть истории после слизм репрезентативного
      let processedThisBatch = 0;
      for (const borrower of uniqueBorrowers) {
        if (processedThisBatch >= this.config.maxScanBatchSize) break;
        if (this.skippingCache.has(borrower.toLowerCase())) continue;

        try {
          const position = await this.healthFactorCalculator.getPositionDetails(borrower);

          // Проверяем что позиция актуальна и определенного размера
          if (position && position.debtValueUsd && position.debtValueUsd >= this.config.minPositionSizeUsd) {
            // Проверяем health factor
            const isLiquidatable = position.healthFactor < this.config.minHealthFactor;

            const result: PositionScanResult = {
              account: borrower,
              healthFactor: position.healthFactor,
              totalBorrowUsd: position.debtValueUsd,
              totalCollateralUsd: position.collateralValueUsd,
              isLiquidatable,
              markets: {
                borrow: position.borrowTokens,
                collateral: position.collateralTokens,
              },
            };

            if (isLiquidatable) {
              // Liquidatable position found
              await this.onPositionDiscovered(result);
              positionsTotal.add(borrower);

              hasActiveBorrowers = true;
              logger.info("[SCAN] Liquidatable position found", {
                account: borrower,
                healthFactor: position.healthFactor,
                borrowUsd: position.debtValueUsd,
                collateralUsd: position.collateralValueUsd,
              });
            } else if (position.healthFactor >= 1.1 && position.healthFactor < 2) {
              // High risk positions - add for monitoring
              await this.onPositionDiscovered(result);
              positionsTotal.add(borrower);
            } else {
              // Healthy position - cache to skip for now
              this.skippingCache.add(borrower.toLowerCase());
            }
          } else {
            positionsSkippedInCache.push(borrower);
          }

          processedThisBatch++;
        } catch (error) {
          logger.warn("[SCAN] Failed to process borrower position", { borrower, error: String(error) });
          this.skippingCache.add(borrower.toLowerCase());
        }
      }

    } catch (error) {
      logger.warn("[SCAN] Error scanning market borrowers", { marketAddress, error: String(error) });
    }

    return hasActiveBorrowers;
  }

  private async getRecentBorrowersFromEvents(vToken: any, fromBlock: number, toBlock: number): Promise<Address[]> {
    const borrowers = new Set<Address>();

    try {
      // Оптимизировано для Node.Real: нельзя более 50,000 блоков за раз
      // Делаем 45K чтобы иметь запас на вариации пихот
      const MAX_NODE_REAL_BLOCKS = 45000;
      const window = Math.min(MAX_NODE_REAL_BLOCKS, Math.floor((toBlock - fromBlock) / 2)); // Разбивка и не превышение лимита
      // const actualWindow = Math.max(100, window); // Не используется, но оставлен для будущих (Минимум 100 блоков чтобы не быть слишком мелким)

      // Borrow events
      const borrowFilter = vToken.filters.Borrow();
      const borrowEvents = await vToken.queryFilter(borrowFilter, Math.max(fromBlock, toBlock - window), toBlock);

      for (const event of borrowEvents.slice(-this.config.maxScanBatchSize)) {
        const args = event.args;
        if (args && args[0]) {
          borrowers.add(args[0] as Address);
        }
      }

      logger.debug("[scan] Found recent borrowers", {
        totalBorrowers: borrowers.size,
        client: "Borrow events"
      });

    } catch (error) {
      logger.warn("[SCAN] Failed to query Borrow events", { error: String(error) });
    }

    return Array.from(borrowers);
  }

  private async getRecentRepayBorrowersFromEvents(vToken: any, fromBlock: number, toBlock: number): Promise<Address[]> {
    const borrowers = new Set<Address>();

    try {
      // Адаптация под Node.Real: такой же лимит 50K блоков
      const MAX_NODE_REAL_BLOCKS = 45000;
      const window = Math.min(MAX_NODE_REAL_BLOCKS, Math.floor((toBlock - fromBlock) / 2));

      const repayFilter = vToken.filters.RepayBorrow();
      const repayEvents = await vToken.queryFilter(repayFilter, Math.max(fromBlock, toBlock - window), toBlock);

      for (const event of repayEvents.slice(-this.config.maxScanBatchSize)) {
        const args = event.args;
        if (args && args[1]) { // borrower is 2nd parameter
          borrowers.add(args[1] as Address);
        }
      }

      logger.debug("[scan] Found recent repayers", {
        totalRepayers: borrowers.size,
        client: "RepayBorrow events"
      });

    } catch (error) {
      logger.warn("[SCAN] Failed to query RepayBorrow events", { error: String(error) });
    }

    return Array.from(borrowers).slice(-this.config.maxScanBatchSize);
  }

  private async getRecentLiquidationBorrowersFromEvents(vToken: any, fromBlock: number, toBlock: number): Promise<Address[]> {
    const borrowers = new Set<Address>();

    try {
      // Адаптация под Node.Real: такой же лимит 50K блоков
      const MAX_NODE_REAL_BLOCKS = 45000;
      const window = Math.min(MAX_NODE_REAL_BLOCKS, Math.floor((toBlock - fromBlock) / 2));

      const liquidateFilter = vToken.filters.LiquidateBorrow();
      const liquidateEvents = await vToken.queryFilter(liquidateFilter, Math.max(fromBlock, toBlock - window), toBlock);

      for (const event of liquidateEvents.slice(-this.config.maxScanBatchSize)) {
        const args = event.args;
        if (args && args[1]) { // borrower is 2nd parameter
          borrowers.add(args[1] as Address);
        }
      }

      logger.debug("[scan] Found recent liquidation borrowers", {
        totalLiquidations: borrowers.size,
        client: "LiquidateBorrow events"
      });

    } catch (error) {
      logger.warn("[SCAN] Failed to query LiquidateBorrow events", { error: String(error) });
    }

    return Array.from(borrowers).slice(-this.config.maxScanBatchSize);
  }

  clearCache(): void {
    this.skippingCache.clear();
    logger.info("[SCAN] Cleared borrower cache - will re-check all positions in next scan");
  }

  getScanStats() {
    return {
      isRunning: this.isRunning,
      cachedBorrowers: this.skippingCache.size,
      lastScanTime: Date.now(), //
    };
  }
}

export default ProtocolPositionScanner;
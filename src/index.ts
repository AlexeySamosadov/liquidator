import { JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { loadConfig } from './config';
import { logger, logBotStart } from './utils/logger';
import VenusContracts from './contracts';
import { MonitoringService, ProtocolScanService } from './services/monitoring';
import { LiquidationEngine } from './services/liquidation';
import { ExecutionService } from './services/execution';
import PriceService from './services/pricing/PriceService';
import { SnapshotService } from './services/snapshot';
import HealthFactorCalculator from './services/monitoring/HealthFactorCalculator';
import { MonitoringMode } from './types';

let monitoringService: any = null;
let liquidationEngine: LiquidationEngine | null = null;
let executionService: ExecutionService | null = null;
let statsInterval: NodeJS.Timeout | null = null;

async function main(): Promise<void> {
  const config = loadConfig();

  const safeConfig = { ...config, privateKey: '***redacted***' };
  logBotStart({ version: '1.0.0', config: safeConfig });

  try {
    const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
    const currentBlock = await provider.getBlockNumber();
    logger.info('RPC connected to BNB Chain', { block: currentBlock });

    const signer = new Wallet(config.privateKey, provider);
    const balance = await provider.getBalance(signer.address);
    logger.info('Wallet initialized', { address: signer.address, balanceBNB: formatEther(balance) });

    const venusContracts = new VenusContracts(provider, config.venus.comptroller);
    await venusContracts.initialize();

    const markets = await venusContracts.getAllVTokens();
    logger.info('Found Venus markets', { count: markets.length });

    const priceService = new PriceService(venusContracts);

    // Initialize liquidation engine regardless of monitoring mode
    liquidationEngine = new LiquidationEngine(venusContracts, signer, provider, config, priceService);
    await liquidationEngine.initialize();
    logger.info('Liquidation engine initialized');

    // Conditional initialization based on monitoring mode
    if (config.monitoringMode === MonitoringMode.ENABLED) {
      monitoringService = new MonitoringService(venusContracts, provider, config, priceService);
      await monitoringService.initialize();
      await monitoringService.start();
      logger.info('Monitoring service started');
    } else if (config.monitoringMode === MonitoringMode.PROTOCOL_SCAN) {
      // NEW: Use comprehensive protocol position scanning instead of event-based monitoring
      monitoringService = new ProtocolScanService(venusContracts, provider, config, priceService);
      await monitoringService.initialize();
      await monitoringService.start();
      logger.info('Protocol position scanning started');
      logger.info('🎯 Now scanning ALL Venus protocol positions, not just event-driven accounts');
    } else if (config.monitoringMode === MonitoringMode.LIQUIDATION_ONLY) {
      // Create snapshot-driven monitoring
      const healthFactorCalculator = new HealthFactorCalculator(venusContracts);
      const snapshotService = new SnapshotService(
        venusContracts,
        healthFactorCalculator,
        async (account) => {
          // Setup minimal monitoring that only processes known positions
          logger.info('Discovered position from snapshot', { account });
          // This would integrate with a simplified monitoring system
        },
        {
          enabled: true,
          updateIntervalMs: 300000, // 5 minutes
          minPositionSizeUsd: config.minPositionSizeUsd,
          topNPositions: 100,
          externalApiUrl: process.env.SNAPSHOT_API_URL || '',
          snapshotFile: process.env.SNAPSHOT_FILE || '',
        },
        provider,
      );

      await snapshotService.start();
      logger.info('Snapshot-based monitoring started');
    } else {
      logger.info('Monitoring service skipped (monitoring mode: DISABLED)');
    }

    // Always initialize execution service
    executionService = new ExecutionService(
      monitoringService,
      liquidationEngine,
      config,
    );

    executionService.start();
    logger.info('Execution service started', {
      intervalMs: config.execution?.intervalMs,
      maxRetries: config.execution?.maxRetries,
      monitoringMode: config.monitoringMode,
    });

    // Only start stats logging if monitoring is enabled
    if (config.monitoringMode === MonitoringMode.ENABLED || config.monitoringMode === MonitoringMode.LIQUIDATION_ONLY) {
      statsInterval = setInterval(() => {
        if (executionService) {
          const executionStats = executionService.getStats();

          const statsReport: any = {
            execution: {
              isRunning: executionStats.isRunning,
              totalExecutions: executionStats.totalExecutions,
              successRate: executionStats.totalExecutions > 0
                ? `${((executionStats.successfulExecutions / executionStats.totalExecutions) * 100).toFixed(1)}%`
                : 'N/A',
              avgExecutionTimeMsPerAttempt: executionStats.averageExecutionTimeMs.toFixed(0),
              positionsInRetry: executionStats.positionsInRetry,
              positionsInCooldown: executionStats.positionsInCooldown,
            },
            rpcTelemetry: {
              priceService: priceService.getTelemetry(),
            },
          };

          // Only include monitoring stats if monitoring service is available
          if (monitoringService) {
            const monitoringStats = monitoringService.getStats();
            statsReport.monitoring = {
              accountsTracked: monitoringStats.totalAccountsTracked,
              liquidatablePositions: monitoringStats.liquidatablePositions,
              avgHealthFactor: monitoringStats.averageHealthFactor.toFixed(3),
              eventsProcessed: monitoringStats.eventsProcessed,
            };
            statsReport.rpcTelemetry.historicalScan = monitoringStats.rpcTelemetry?.historicalScan;
            statsReport.rpcTelemetry.polling = monitoringStats.rpcTelemetry?.polling;
          }

          logger.info('Periodic stats report', statsReport);
        }
      }, config.statsLoggingIntervalMs || 60000);

      logger.info('Stats logging started', { intervalMs: config.statsLoggingIntervalMs || 60000 });
    }
  } catch (error) {
    logger.error('Failed during initialization', { error });
    process.exit(1);
  }

  logger.info('Infrastructure initialized.');
}

main().catch((err) => {
  logger.error('Fatal error during startup', { error: err instanceof Error ? err.message : err });
  process.exit(1);
});

const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }

  try {
    await executionService?.shutdown();
  } catch (error) {
    logger.error('Error during execution service shutdown', { error });
  }

  try {
    await monitoringService?.stop();
  } catch (error) {
    logger.error('Error stopping monitoring service', { error });
  }

  liquidationEngine = null;
  process.exit(0);
};

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

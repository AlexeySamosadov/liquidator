import { JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { loadConfig } from './config';
import { logger, logBotStart } from './utils/logger';
import VenusContracts from './contracts';
import { MonitoringService } from './services/monitoring';
import { LiquidationEngine } from './services/liquidation';
import { ExecutionService } from './services/execution';
import PriceService from './services/pricing/PriceService';

let monitoringService: MonitoringService | null = null;
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

    const incentiveMantissa = await venusContracts
      .getComptroller()
      .liquidationIncentiveMantissa();

    const bonusMantissa = incentiveMantissa - 1_000_000_000_000_000_000n;
    const bonusPercent = Number(bonusMantissa) / 1e16;
    logger.info('Liquidation bonus', { bonusPercent, incentiveMantissa: incentiveMantissa.toString() });

    monitoringService = new MonitoringService(venusContracts, provider, config, priceService);
    await monitoringService.initialize();
    await monitoringService.start();
    logger.info('Monitoring service started');

    liquidationEngine = new LiquidationEngine(venusContracts, signer, provider, config, priceService);
    await liquidationEngine.initialize();
    logger.info('Liquidation engine initialized');

    executionService = new ExecutionService(
      monitoringService,
      liquidationEngine,
      config,
    );

    executionService.start();
    logger.info('Execution service started', {
      intervalMs: config.execution?.intervalMs,
      maxRetries: config.execution?.maxRetries,
    });

    statsInterval = setInterval(() => {
      if (monitoringService && executionService) {
        const monitoringStats = monitoringService.getStats();
        const executionStats = executionService.getStats();

        logger.info('Periodic stats report', {
          monitoring: {
            accountsTracked: monitoringStats.totalAccountsTracked,
            liquidatablePositions: monitoringStats.liquidatablePositions,
            avgHealthFactor: monitoringStats.averageHealthFactor.toFixed(3),
            eventsProcessed: monitoringStats.eventsProcessed,
          },
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
        });
      }
    }, config.statsLoggingIntervalMs || 60000);

    logger.info('Stats logging started', { intervalMs: config.statsLoggingIntervalMs || 60000 });
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

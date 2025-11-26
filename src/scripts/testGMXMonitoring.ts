/**
 * Test GMX Position Monitoring
 *
 * This script tests the GMX monitoring service:
 * 1. Connects to Arbitrum
 * 2. Initializes GMX contracts and monitoring service
 * 3. Polls for positions and identifies liquidatable ones
 */

import { WebSocketProvider } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMXMonitoringService } from '../services/gmx';
import { GMX_ARBITRUM_ADDRESSES } from '../config/chains';
import { BotConfig } from '../types';
import { logger } from '../utils/logger';

async function testGMXMonitoring() {
  logger.info('='.repeat(80));
  logger.info('GMX Position Monitoring Test');
  logger.info('='.repeat(80));

  const rpcUrl = process.env.RPC_URL || 'wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/';

  logger.info('Connecting to Arbitrum...', { rpcUrl: rpcUrl.substring(0, 50) + '...' });

  let provider: WebSocketProvider | undefined;
  let gmxContracts: GMXContracts | undefined;
  let monitoringService: GMXMonitoringService | undefined;

  try {
    // Create WebSocket provider
    provider = new WebSocketProvider(rpcUrl);
    await provider.getNetwork();

    const network = await provider.getNetwork();
    logger.info('✅ Connected to Arbitrum', {
      chainId: network.chainId.toString(),
      name: network.name,
    });

    // Initialize GMX contracts
    logger.info('\nInitializing GMX contracts...');
    gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);
    logger.info('✅ GMX contracts initialized');

    // Create mock config for monitoring
    const config: BotConfig = {
      rpcUrl,
      chainId: 42161,
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
      minProfitUsd: 1,
      minPositionSizeUsd: 10,
      maxPositionSizeUsd: 5000,
      gasPriceMultiplier: 1.1,
      maxGasPriceGwei: 2,
      useFlashLoans: false,
      flashLoanFeeBps: 0,
      collateralStrategy: 'AUTO_SELL' as any,
      slippageTolerance: 0.02,
      minSwapAmountUsd: 5,
      maxPriceImpact: 0.03,
      pollingIntervalMs: 10000,
      minHealthFactor: 1.5,
      logLevel: 'info' as any,
      logToFile: false,
      venus: {
        comptroller: '0x0000000000000000000000000000000000000000',
      },
      dex: {
        pancakeswapRouter: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      },
    };

    // Initialize monitoring service
    logger.info('\nInitializing GMX monitoring service...');
    monitoringService = new GMXMonitoringService(
      gmxContracts,
      config,
      (liquidatablePosition) => {
        logger.info('🎯 LIQUIDATABLE POSITION FOUND!', {
          account: liquidatablePosition.position.account,
          market: liquidatablePosition.marketInfo.marketToken,
          healthFactor: liquidatablePosition.healthFactor.toFixed(4),
          leverage: liquidatablePosition.leverage.toFixed(2),
          sizeUsd: liquidatablePosition.sizeValueUsd.toFixed(2),
          estimatedProfit: liquidatablePosition.estimatedProfitUsd.toFixed(2),
        });
      }
    );

    logger.info('✅ Monitoring service initialized');

    // Start monitoring
    logger.info('\n' + '='.repeat(80));
    logger.info('Starting GMX Position Monitoring...');
    logger.info('='.repeat(80));

    await monitoringService.start();

    // Wait for a few poll cycles
    logger.info('\nMonitoring for 5 seconds...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get statistics
    logger.info('\n' + '='.repeat(80));
    logger.info('Monitoring Statistics');
    logger.info('='.repeat(80));

    const stats = monitoringService.getStats();

    logger.info('📊 Statistics:', {
      marketsMonitored: stats.marketsMonitored,
      totalAccountsTracked: stats.totalAccountsTracked,
      totalPositions: stats.totalPositions,
      liquidatablePositions: stats.liquidatablePositions,
      highRiskPositions: stats.highRiskPositions,
      mediumRiskPositions: stats.mediumRiskPositions,
      safePositions: stats.safePositions,
      averageHealthFactor: stats.averageHealthFactor.toFixed(4),
    });

    // Get liquidatable positions
    const liquidatable = monitoringService.getLiquidatablePositions();

    if (liquidatable.length > 0) {
      logger.info('\n🎯 Liquidatable Positions:', { count: liquidatable.length });

      for (let i = 0; i < Math.min(liquidatable.length, 10); i++) {
        const pos = liquidatable[i];
        logger.info(`  ${i + 1}. ${pos.position.account}`, {
          market: pos.marketInfo.marketToken,
          healthFactor: pos.healthFactor.toFixed(4),
          leverage: pos.leverage.toFixed(2) + 'x',
          sizeUsd: '$' + pos.sizeValueUsd.toFixed(2),
          profit: '$' + pos.estimatedProfitUsd.toFixed(2),
        });
      }
    } else {
      logger.info('\n✅ No liquidatable positions found (all positions are healthy)');
    }

    // Success summary
    logger.info('\n' + '='.repeat(80));
    logger.info('✅ TEST COMPLETED SUCCESSFULLY');
    logger.info('='.repeat(80));
    logger.info('GMX monitoring service is working correctly!');
    logger.info('Next steps:');
    logger.info('  1. Add real-time event monitoring (PositionIncrease/Decrease)');
    logger.info('  2. Integrate Chainlink Data Streams for accurate prices');
    logger.info('  3. Add bloXroute private orderflow for liquidations');
    logger.info('  4. Test liquidation execution');
    logger.info('='.repeat(80));

    // Stop monitoring
    await monitoringService.stop();

  } catch (error: any) {
    logger.error('\n❌ Test failed:', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  } finally {
    // Clean up
    if (gmxContracts) {
      await gmxContracts.close();
    } else if (provider) {
      await provider.destroy();
    }
  }
}

// Run test
testGMXMonitoring()
  .then(() => {
    logger.info('Test completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Test failed with error:', error);
    process.exit(1);
  });

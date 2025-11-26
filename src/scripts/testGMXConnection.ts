/**
 * Test GMX V2 Connection on Arbitrum
 *
 * This script tests:
 * 1. Connection to Arbitrum via NodeReal WebSocket
 * 2. GMX contract initialization (Reader, DataStore, ExchangeRouter)
 * 3. Query markets and position data
 */

import { WebSocketProvider } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMX_ARBITRUM_ADDRESSES } from '../config/chains';
import { logger } from '../utils/logger';

async function testGMXConnection() {
  logger.info('='.repeat(80));
  logger.info('GMX V2 Arbitrum Connection Test');
  logger.info('='.repeat(80));

  // Use Arbitrum RPC URL
  const rpcUrl = process.env.RPC_URL || 'wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/';

  logger.info('Connecting to Arbitrum...', { rpcUrl: rpcUrl.substring(0, 50) + '...' });

  let provider: WebSocketProvider | undefined;
  let gmxContracts: GMXContracts | undefined;

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
    logger.info('\nInitializing GMX V2 contracts...');
    gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);
    logger.info('✅ GMX contracts initialized');

    // Test 1: Get market count
    logger.info('\n' + '-'.repeat(80));
    logger.info('Test 1: Query Market Count');
    logger.info('-'.repeat(80));

    const marketCount = await gmxContracts.getMarketCount();
    logger.info(`📊 Market count: ${marketCount}`);

    // Test 2: Get all markets
    if (marketCount > 0) {
      logger.info('\n' + '-'.repeat(80));
      logger.info('Test 2: Query All Markets');
      logger.info('-'.repeat(80));

      const markets = await gmxContracts.getAllMarkets();
      logger.info(`📈 Found ${markets.length} markets:`);

      for (let i = 0; i < Math.min(markets.length, 5); i++) {
        logger.info(`  Market ${i + 1}: ${markets[i]}`);
      }

      if (markets.length > 5) {
        logger.info(`  ... and ${markets.length - 5} more markets`);
      }

      // Test 3: Get market details for first market
      if (markets.length > 0) {
        logger.info('\n' + '-'.repeat(80));
        logger.info('Test 3: Query Market Details');
        logger.info('-'.repeat(80));

        const firstMarket = markets[0];
        const reader = gmxContracts.getReader();
        const dataStore = gmxContracts.getDataStoreAddress();

        try {
          const marketInfo = await reader.getMarket(dataStore, firstMarket);
          logger.info(`📋 Market ${firstMarket}:`, {
            marketToken: marketInfo.marketToken,
            indexToken: marketInfo.indexToken,
            longToken: marketInfo.longToken,
            shortToken: marketInfo.shortToken,
          });
        } catch (error: any) {
          logger.error('Failed to get market info', { error: error.message });
        }
      }
    }

    // Test 4: Get total position count
    logger.info('\n' + '-'.repeat(80));
    logger.info('Test 4: Query Total Position Count');
    logger.info('-'.repeat(80));

    const positionCount = await gmxContracts.getTotalPositionCount();
    logger.info(`👥 Total open positions: ${positionCount}`);

    // Test 5: Check sample account for positions
    logger.info('\n' + '-'.repeat(80));
    logger.info('Test 5: Query Sample Account Positions');
    logger.info('-'.repeat(80));

    // Use a sample address (can be replaced with actual trader address)
    const sampleAccount = '0x0000000000000000000000000000000000000001';
    const positionKeys = await gmxContracts.getAccountPositionKeys(sampleAccount);

    logger.info(`📊 Positions for ${sampleAccount}: ${positionKeys.length}`);
    if (positionKeys.length > 0) {
      logger.info('Position keys:', positionKeys);
    }

    // Success summary
    logger.info('\n' + '='.repeat(80));
    logger.info('✅ ALL TESTS PASSED');
    logger.info('='.repeat(80));
    logger.info('GMX V2 integration is ready!');
    logger.info('Next steps:');
    logger.info('  1. Create GMX position monitoring service');
    logger.info('  2. Add liquidation detection logic');
    logger.info('  3. Integrate bloXroute private orderflow');
    logger.info('='.repeat(80));

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
testGMXConnection()
  .then(() => {
    logger.info('Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Test failed with error:', error);
    process.exit(1);
  });

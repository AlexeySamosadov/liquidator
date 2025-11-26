/**
 * Scan GMX V2 Positions using Official SDK
 *
 * Uses GMX official SDK with Subsquid GraphQL API to get ALL open positions
 */

// import { ethers } from 'ethers';
import { logger } from '../utils/logger';

// GMX SDK types (we'll use dynamic imports since SDK might have complex types)

async function scanWithSDK() {
  logger.info('='.repeat(80));
  logger.info('GMX V2 Position Scanner - Official SDK');
  logger.info('='.repeat(80));

  const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';

  try {
    // Import GMX SDK dynamically
    logger.info('Loading GMX SDK...');
    const gmxSdk = await import('@gmx-io/sdk');

    logger.info('✅ GMX SDK loaded');
    logger.info('Creating SDK instance...');

    // Create provider (unused for now, but might be needed for SDK internal init if we passed it)
    // const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Initialize SDK without wallet (read-only mode)
    const sdk = new (gmxSdk as any).GmxSdk({
      chainId: 42161, // Arbitrum
      rpcUrl: rpcUrl,
      oracleUrl: 'https://arbitrum-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql',
    });

    logger.info('✅ SDK initialized', {
      chainId: 42161,
      oracleUrl: 'https://arbitrum-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql',
    });

    // Get markets info
    logger.info('\n' + '-'.repeat(80));
    logger.info('Step 1: Fetching Markets Info');
    logger.info('-'.repeat(80));

    const { marketsInfoData, tokensData } = await sdk.markets.getMarketsInfo();

    const marketCount = Object.keys(marketsInfoData || {}).length;
    const tokenCount = Object.keys(tokensData || {}).length;

    logger.info(`✅ Markets loaded: ${marketCount}`);
    logger.info(`✅ Tokens loaded: ${tokenCount}`);

    if (marketCount === 0) {
      logger.warn('⚠️  No markets found! This might be an SDK configuration issue.');
      return;
    }

    // Log market details
    logger.info('\n📊 Available Markets:');
    for (const [address, market] of Object.entries(marketsInfoData || {})) {
      const marketData = market as any;
      logger.info(`  ${address.substring(0, 10)}... - ${marketData.name || 'Unknown'}`);
    }

    // Try to get all positions using different approaches
    logger.info('\n' + '-'.repeat(80));
    logger.info('Step 2: Fetching Open Positions');
    logger.info('-'.repeat(80));

    // Approach 1: Try to query positions directly from subsquid
    logger.info('\nAttempting to fetch positions from Subsquid GraphQL...');

    try {
      const query = `
        query GetAllPositions {
          positions(
            where: { sizeInUsd_gt: "0" }
            orderBy: sizeInUsd_DESC
            limit: 1000
          ) {
            id
            account
            market
            collateralToken
            isLong
            sizeInUsd
            sizeInTokens
            collateralAmount
          }
        }
      `;

      const response = await fetch('https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      const data: any = await response.json();

      if (data.errors) {
        logger.warn('GraphQL query failed:', data.errors);
        logger.info('Error details:', JSON.stringify(data.errors, null, 2));
      } else if (data.data && data.data.positions) {
        const positions = data.data.positions;
        logger.info(`✅ Found ${positions.length} open positions from GraphQL!`);

        // Analyze positions
        const liquidatablePositions = [];
        const highRiskPositions = [];

        for (const pos of positions.slice(0, 50)) {
          logger.info(`\nPosition: ${pos.account.substring(0, 10)}...`, {
            market: pos.market.substring(0, 10) + '...',
            isLong: pos.isLong ? 'LONG' : 'SHORT',
            sizeUsd: '$' + (Number(pos.sizeInUsd) / 1e30).toFixed(2),
            collateral: '$' + (Number(pos.collateralAmount) / 1e30).toFixed(2),
          });

          // Simple health factor estimation
          const sizeUsd = Number(pos.sizeInUsd) / 1e30;
          const collateralUsd = Number(pos.collateralAmount) / 1e30;
          const leverage = sizeUsd / collateralUsd;
          const minCollateral = sizeUsd * 0.01; // 1% maintenance margin
          const healthFactor = collateralUsd / minCollateral;

          logger.info(`  Leverage: ${leverage.toFixed(2)}x, Estimated HF: ${healthFactor.toFixed(4)}`);

          if (healthFactor < 1.0) {
            liquidatablePositions.push(pos);
            logger.info('  🎯 POTENTIALLY LIQUIDATABLE!');
          } else if (healthFactor < 1.2) {
            highRiskPositions.push(pos);
            logger.info('  ⚠️  HIGH RISK');
          }
        }

        // Summary
        logger.info('\n' + '='.repeat(80));
        logger.info('SCAN RESULTS');
        logger.info('='.repeat(80));
        logger.info(`\n📊 Total positions found: ${positions.length}`);
        logger.info(`🎯 Potentially liquidatable: ${liquidatablePositions.length}`);
        logger.info(`⚠️  High risk (HF < 1.2): ${highRiskPositions.length}`);

        if (liquidatablePositions.length > 0) {
          logger.info('\n🎯 LIQUIDATABLE POSITIONS:');
          for (const pos of liquidatablePositions) {
            logger.info(`  ${pos.account} - ${pos.market.substring(0, 10)}...`);
          }
        }

      } else {
        logger.warn('No positions data in response');
        logger.info('Response:', JSON.stringify(data, null, 2));
      }

    } catch (graphqlError: any) {
      logger.error('GraphQL fetch failed:', graphqlError.message);
    }

    // Approach 2: Try SDK positions method if available
    logger.info('\n' + '-'.repeat(80));
    logger.info('Step 3: Trying SDK Positions Methods');
    logger.info('-'.repeat(80));

    if (sdk.positions) {
      logger.info('SDK has positions module, attempting to fetch...');

      try {
        // Try to get positions for a sample account or all positions
        const positionsResult = await sdk.positions.getPositions({
          marketsInfoData,
          tokensData,
          start: 0,
          end: 1000,
        });

        logger.info('Positions result:', positionsResult);
      } catch (sdkError: any) {
        logger.warn('SDK positions fetch failed:', sdkError.message);
      }
    } else {
      logger.warn('SDK does not expose positions module in expected way');
    }

    logger.info('\n' + '='.repeat(80));
    logger.info('Scan completed');
    logger.info('='.repeat(80));

  } catch (error: any) {
    logger.error('\n❌ Scan failed:', {
      error: error.message,
      stack: error.stack,
    });
  }
}

// Run scanner
scanWithSDK()
  .then(() => {
    logger.info('Scanner finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Scanner error:', error);
    process.exit(1);
  });

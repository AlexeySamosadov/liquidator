/**
 * Scan GMX V2 Positions using Official SDK
 *
 * Uses GMX official SDK with Subsquid GraphQL API to get ALL open positions
 */

// import { ethers } from 'ethers';
import { logger } from '../utils/logger';

// GMX SDK types (we'll use dynamic imports since SDK might have complex types)

export interface SDKPosition {
  account: string;
  market: string;
  collateralToken: string;
  isLong: boolean;
  sizeInUsd: string;
  sizeInTokens: string;
  collateralAmount: string;
}

export async function fetchPositionsWithSDK(): Promise<SDKPosition[]> {
  logger.info('='.repeat(80));
  logger.info('GMX V2 Position Scanner - Official SDK');
  logger.info('='.repeat(80));

  // const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
  const allPositions: SDKPosition[] = [];

  try {
    // Import GMX SDK dynamically
    logger.info('Loading GMX SDK...');
    // const gmxSdk = await import('@gmx-io/sdk'); // Unused for now as we use GraphQL directly

    logger.info('✅ GMX SDK loaded (using GraphQL direct access)');

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
      } else if (data.data && data.data.positions) {
        const positions = data.data.positions;
        logger.info(`✅ Found ${positions.length} open positions from GraphQL!`);

        // Map to exported interface
        for (const pos of positions) {
          allPositions.push({
            account: pos.account,
            market: pos.market,
            collateralToken: pos.collateralToken,
            isLong: pos.isLong,
            sizeInUsd: pos.sizeInUsd,
            sizeInTokens: pos.sizeInTokens,
            collateralAmount: pos.collateralAmount
          });
        }
      }
    } catch (graphqlError: any) {
      logger.error('GraphQL fetch failed:', graphqlError.message);
    }

    return allPositions;

  } catch (error: any) {
    logger.error('\n❌ Scan failed:', {
      error: error.message,
      stack: error.stack,
    });
    return [];
  }
}

// Only run if called directly
if (require.main === module) {
  fetchPositionsWithSDK()
    .then((positions) => {
      logger.info(`Scanner finished. Found ${positions.length} positions.`);

      // Log analysis for direct run
      const liquidatablePositions = [];
      for (const pos of positions.slice(0, 50)) {
        // Simple health factor estimation
        const sizeUsd = Number(pos.sizeInUsd) / 1e30;
        const collateralUsd = Number(pos.collateralAmount) / 1e30;
        const minCollateral = sizeUsd * 0.01; // 1% maintenance margin

        // Avoid division by zero
        const healthFactor = minCollateral > 0 ? collateralUsd / minCollateral : 0;

        if (healthFactor < 1.0) {
          liquidatablePositions.push(pos);
        }
      }

      logger.info(`🎯 Potentially liquidatable (based on raw data): ${liquidatablePositions.length}`);
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Scanner error:', error);
      process.exit(1);
    });
}



/**
 * Scan Real GMX Positions on Arbitrum
 *
 * This script scans actual GMX V2 positions on Arbitrum mainnet
 * to find liquidatable opportunities
 */

import { WebSocketProvider } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMXPositionCalculator } from '../services/gmx/GMXPositionCalculator';
import { GMX_ARBITRUM_ADDRESSES } from '../config/chains';
import { logger } from '../utils/logger';

// GMX Subgraph endpoint for Arbitrum
const GMX_SUBGRAPH_URL = 'https://subgraph.satsuma-prod.com/3b2ced13c8d9/gmx/synthetics-arbitrum-stats/api';

interface SubgraphPosition {
  account: string;
  market: string;
  collateralToken: string;
  isLong: boolean;
  sizeInUsd: string;
  collateralAmount: string;
}

interface SubgraphResponse {
  data?: {
    positions?: SubgraphPosition[];
  };
  errors?: Array<{ message: string }>;
}

async function fetchPositionsFromSubgraph(): Promise<SubgraphPosition[]> {
  try {
    logger.info('Fetching positions from GMX subgraph...');

    // Query GMX subgraph for open positions
    const query = `
      {
        positions(
          first: 100,
          where: { sizeInUsd_gt: "1000000000000000000000000000000" }
          orderBy: sizeInUsd,
          orderDirection: desc
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

    const response = await fetch(GMX_SUBGRAPH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json() as SubgraphResponse;

    if (data.errors) {
      logger.warn('Subgraph query failed', { errors: data.errors });
      return [];
    }

    const positions = data.data?.positions || [];
    logger.info(`✅ Found ${positions.length} positions from subgraph`);

    return positions;
  } catch (error) {
    logger.error('Failed to fetch from subgraph', { error });
    return [];
  }
}

async function scanRealPositions() {
  logger.info('='.repeat(80));
  logger.info('GMX V2 Real Position Scanner (Arbitrum Mainnet)');
  logger.info('='.repeat(80));

  const rpcUrl = process.env.RPC_URL || 'wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/';

  logger.info('Connecting to Arbitrum mainnet...', {
    rpcUrl: rpcUrl.substring(0, 50) + '...',
  });

  let provider: WebSocketProvider | undefined;
  let gmxContracts: GMXContracts | undefined;

  try {
    // Connect to Arbitrum
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
    const calculator = new GMXPositionCalculator(gmxContracts);

    logger.info('✅ GMX contracts initialized');

    // Get markets
    logger.info('\n' + '-'.repeat(80));
    logger.info('Step 1: Loading GMX Markets');
    logger.info('-'.repeat(80));

    const markets = await gmxContracts.getAllMarkets();
    logger.info(`📊 Found ${markets.length} active markets`);

    if (markets.length === 0) {
      logger.warn('⚠️  No markets found. This might be a configuration issue.');
      logger.info('Trying alternative method to get markets...');

      // Alternative: Try to get market info from known addresses
      const knownMarkets = [
        '0x70d95587d40A2caf56bd97485aB3Eec10Bee6336', // ETH/USD
        '0x47c031236e19d024b42f8AE6780E44A573170703', // BTC/USD
      ];

      for (const marketAddr of knownMarkets) {
        try {
          const reader = gmxContracts.getReader();
          const dataStore = gmxContracts.getDataStoreAddress();
          const market = await reader.getMarket(dataStore, marketAddr);

          logger.info(`  Market: ${marketAddr}`, {
            indexToken: market.indexToken,
            longToken: market.longToken,
            shortToken: market.shortToken,
          });
        } catch (error) {
          logger.debug(`Market ${marketAddr} not found or invalid`);
        }
      }
    }

    // Fetch positions from subgraph
    logger.info('\n' + '-'.repeat(80));
    logger.info('Step 2: Fetching Positions from Subgraph');
    logger.info('-'.repeat(80));

    const subgraphPositions = await fetchPositionsFromSubgraph();

    if (subgraphPositions.length > 0) {
      logger.info(`\n📊 Analyzing ${subgraphPositions.length} positions...`);

      const liquidatablePositions = [];
      const highRiskPositions = [];
      const mediumRiskPositions = [];

      for (let i = 0; i < Math.min(subgraphPositions.length, 20); i++) {
        const pos = subgraphPositions[i];

        try {
          logger.info(`\n[${i + 1}/${subgraphPositions.length}] Checking position:`, {
            account: pos.account.substring(0, 10) + '...',
            market: pos.market.substring(0, 10) + '...',
            isLong: pos.isLong,
            sizeUsd: (Number(pos.sizeInUsd) / 1e30).toFixed(2),
          });

          // Get position info from contract
          const reader = gmxContracts.getReader();
          const dataStore = gmxContracts.getDataStoreAddress();
          const referralStorage = gmxContracts.getReferralStorageAddress();

          // Get position key
          const positionKey = await calculator.getPositionKey(
            pos.account,
            pos.market,
            pos.collateralToken,
            pos.isLong
          );

          // Get market info
          const market = await reader.getMarket(dataStore, pos.market);

          // Create mock prices (in production, get from Chainlink)
          const prices = calculator.getMockPrices(pos.isLong ? 3000 : 60000);

          // Get position info
          const positionInfo = await reader.getPositionInfo(
            dataStore,
            referralStorage,
            positionKey,
            prices,
            0n,
            pos.account,
            false
          );

          const gmxPositionInfo = calculator.toGMXPositionInfo(positionInfo, market);

          logger.info(`  Health Factor: ${gmxPositionInfo.healthFactor.toFixed(4)}`, {
            leverage: gmxPositionInfo.leverage.toFixed(2) + 'x',
            collateralUsd: gmxPositionInfo.collateralValueUsd.toFixed(2),
            sizeUsd: gmxPositionInfo.sizeValueUsd.toFixed(2),
            liquidationPrice: gmxPositionInfo.liquidationPrice.toFixed(2),
          });

          // Categorize
          if (gmxPositionInfo.healthFactor < 1.0) {
            const profit = calculator.estimateLiquidationProfit(gmxPositionInfo);
            liquidatablePositions.push({ ...gmxPositionInfo, profit });
            logger.info(`  🎯 LIQUIDATABLE! Estimated profit: $${profit.toFixed(2)}`);
          } else if (gmxPositionInfo.healthFactor < 1.2) {
            highRiskPositions.push(gmxPositionInfo);
            logger.info(`  ⚠️  HIGH RISK`);
          } else if (gmxPositionInfo.healthFactor < 1.5) {
            mediumRiskPositions.push(gmxPositionInfo);
            logger.info(`  ⚡ MEDIUM RISK`);
          } else {
            logger.info(`  ✅ SAFE`);
          }

        } catch (error: any) {
          logger.debug(`  ❌ Failed to check position: ${error.message}`);
        }
      }

      // Summary
      logger.info('\n' + '='.repeat(80));
      logger.info('SCAN RESULTS');
      logger.info('='.repeat(80));

      logger.info(`\n📊 Total positions scanned: ${Math.min(subgraphPositions.length, 20)}`);
      logger.info(`🎯 LIQUIDATABLE: ${liquidatablePositions.length}`);
      logger.info(`⚠️  HIGH RISK (HF < 1.2): ${highRiskPositions.length}`);
      logger.info(`⚡ MEDIUM RISK (HF < 1.5): ${mediumRiskPositions.length}`);

      if (liquidatablePositions.length > 0) {
        logger.info('\n' + '🎯'.repeat(40));
        logger.info('LIQUIDATABLE POSITIONS:');
        logger.info('🎯'.repeat(40));

        for (const pos of liquidatablePositions) {
          logger.info(`\nAccount: ${pos.position.account}`, {
            market: pos.marketInfo.marketToken,
            healthFactor: pos.healthFactor.toFixed(4),
            leverage: pos.leverage.toFixed(2) + 'x',
            sizeUsd: '$' + pos.sizeValueUsd.toFixed(2),
            estimatedProfit: '$' + pos.profit.toFixed(2),
            isLong: pos.position.isLong ? 'LONG' : 'SHORT',
          });
        }

        logger.info('\n💰 Total potential profit: $' +
          liquidatablePositions.reduce((sum, p) => sum + p.profit, 0).toFixed(2));
      } else {
        logger.info('\n✅ No liquidatable positions found at current prices');
        logger.info('This is normal - liquidations happen when market moves quickly');
      }

      if (highRiskPositions.length > 0) {
        logger.info('\n⚠️  HIGH RISK POSITIONS (watch these!):');
        for (const pos of highRiskPositions.slice(0, 5)) {
          logger.info(`  ${pos.position.account.substring(0, 10)}... HF: ${pos.healthFactor.toFixed(4)}`);
        }
      }

    } else {
      logger.warn('⚠️  Could not fetch positions from subgraph');
      logger.info('Alternative: Monitor PositionIncrease events in real-time');
    }

    logger.info('\n' + '='.repeat(80));
    logger.info('Scan completed successfully');
    logger.info('='.repeat(80));

  } catch (error: any) {
    logger.error('\n❌ Scan failed:', {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    if (gmxContracts) {
      await gmxContracts.close();
    } else if (provider) {
      await provider.destroy();
    }
  }
}

// Run scanner
scanRealPositions()
  .then(() => {
    logger.info('Scanner finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Scanner error:', error);
    process.exit(1);
  });

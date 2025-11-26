/**
 * Scan GMX V2 Positions via EventEmitter
 *
 * This script monitors PositionIncrease events to discover positions
 * and checks their health factors for liquidation opportunities
 */

import { WebSocketProvider, Contract, EventLog, keccak256, toUtf8Bytes } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMXPositionCalculator } from '../services/gmx/GMXPositionCalculator';
import { GMX_ARBITRUM_ADDRESSES } from '../config/chains';
import { logger } from '../utils/logger';
import { Address } from '../types';

// GMX V2 EventEmitter on Arbitrum
const EVENT_EMITTER_ADDRESS = '0xC8ee91A54287DB53897056e12D9819156D3822Fb';

// GMX V2 uses generic EventLog events with eventNameHash to identify event types
const EVENT_EMITTER_ABI = [
  'event EventLog(address indexed msgSender, string indexed eventName, string indexed topic1, tuple(tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) addressValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) uintValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) intValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) boolValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytes32Values, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytesValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) stringValues) eventData)',
  'event EventLog1(address indexed msgSender, bytes32 indexed eventNameHash, bytes32 indexed topic1, tuple(tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) addressValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) uintValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) intValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) boolValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytes32Values, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytesValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) stringValues) eventData)',
  'event EventLog2(address indexed msgSender, bytes32 indexed eventNameHash, bytes32 indexed topic1, bytes32 topic2, tuple(tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) addressValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) uintValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) intValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) boolValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytes32Values, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytesValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) stringValues) eventData)',
];

// Calculate event name hash for PositionIncrease
const POSITION_INCREASE_HASH = keccak256(toUtf8Bytes('PositionIncrease'));

interface DiscoveredPosition {
  account: Address;
  market: Address;
  collateralToken: Address;
  isLong: boolean;
  positionKey: string;
}

async function scanRecentPositions() {
  logger.info('='.repeat(80));
  logger.info('GMX V2 Position Scanner via EventEmitter (Arbitrum)');
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

    // Initialize EventEmitter contract
    const eventEmitter = new Contract(EVENT_EMITTER_ADDRESS, EVENT_EMITTER_ABI, provider);

    logger.info('✅ GMX contracts initialized');
    logger.info('✅ EventEmitter connected', { address: EVENT_EMITTER_ADDRESS });

    // Get current block
    const currentBlock = await provider.getBlockNumber();
    logger.info(`Current block: ${currentBlock}`);

    // Scan last 50,000 blocks (~41 hours on Arbitrum with ~3s block time)
    const fromBlock = currentBlock - 50000;
    logger.info(`\nScanning all events from block ${fromBlock} to ${currentBlock}...`);
    logger.info(`Looking for PositionIncrease events (hash: ${POSITION_INCREASE_HASH})...`);

    // Get all EventLog1 and EventLog2 events (these contain PositionIncrease/Decrease)
    const filter1 = eventEmitter.filters.EventLog1();
    const filter2 = eventEmitter.filters.EventLog2();

    logger.info('Fetching EventLog1 events...');
    const events1 = await eventEmitter.queryFilter(filter1, fromBlock, currentBlock);
    logger.info(`Found ${events1.length} EventLog1 events`);

    logger.info('Fetching EventLog2 events...');
    const events2 = await eventEmitter.queryFilter(filter2, fromBlock, currentBlock);
    logger.info(`Found ${events2.length} EventLog2 events`);

    const allEvents = [...events1, ...events2];

    // Filter for PositionIncrease events
    const positionIncreaseEvents = allEvents.filter(event => {
      if (event instanceof EventLog && event.args) {
        const eventNameHash = event.args[1]; // eventNameHash is the second parameter
        return eventNameHash === POSITION_INCREASE_HASH;
      }
      return false;
    });

    logger.info(`\n📊 Found ${positionIncreaseEvents.length} PositionIncrease events in last 50,000 blocks`);

    if (positionIncreaseEvents.length === 0) {
      logger.warn('⚠️  No PositionIncrease events found.');
      logger.info('Let me show all unique event types from EventLog1/EventLog2:');

      const eventTypes = new Set<string>();
      for (const event of allEvents.slice(0, 100)) {
        if (event instanceof EventLog && event.args) {
          const eventNameHash = event.args[1];
          eventTypes.add(eventNameHash);
        }
      }

      logger.info(`\nFound ${eventTypes.size} unique event types:`);
      for (const hash of Array.from(eventTypes).slice(0, 10)) {
        logger.info(`  - ${hash}`);
      }

      logger.info('\nThis could mean:');
      logger.info('1. Position events use a different event structure');
      logger.info('2. GMX V2 has very low trading activity');
      logger.info('3. We need to scan more blocks or check different contracts');
      return;
    }

    // Deduplicate positions by key
    const positionMap = new Map<string, DiscoveredPosition>();
    for (const event of positionIncreaseEvents) {
      if (event instanceof EventLog) {
        // For GMX V2, the position key is topic1 (third parameter in EventLog1/2)
        const positionKey = event.args[2]; // topic1

        // Parse event data from the eventData tuple
        const eventData = event.args[3];

        // Extract position details from eventData
        // GMX V2 stores data in separate arrays: addressItems, uintItems, etc.
        const addressItems = eventData.addressValues?.addressItems || [];
        const boolItems = eventData.boolValues?.boolItems || [];

        if (addressItems.length >= 3) {
          const account = addressItems[0];
          const market = addressItems[1];
          const collateralToken = addressItems[2];
          const isLong = boolItems[0] || false;

          if (!positionMap.has(positionKey)) {
            positionMap.set(positionKey, {
              account,
              market,
              collateralToken,
              isLong,
              positionKey,
            });
          }
        }
      }
    }

    logger.info(`\n📍 Unique positions discovered: ${positionMap.size}`);

    // Check health factor for each position
    logger.info('\n' + '-'.repeat(80));
    logger.info('Checking Position Health Factors');
    logger.info('-'.repeat(80));

    const liquidatablePositions = [];
    const highRiskPositions = [];
    const closedPositions = [];
    let checked = 0;

    for (const [positionKey, pos] of positionMap) {
      checked++;
      logger.info(`\n[${checked}/${positionMap.size}] Checking position:`, {
        account: pos.account.substring(0, 10) + '...',
        market: pos.market.substring(0, 10) + '...',
        isLong: pos.isLong ? 'LONG' : 'SHORT',
      });

      try {
        // Get market info
        const reader = gmxContracts.getReader();
        const dataStore = gmxContracts.getDataStoreAddress();
        const referralStorage = gmxContracts.getReferralStorageAddress();

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

        // Check if position is still open (sizeInUsd > 0)
        if (positionInfo.position.sizeInUsd === 0n) {
          closedPositions.push(pos);
          logger.info('  ✅ Position closed (size = 0)');
          continue;
        }

        const gmxPositionInfo = calculator.toGMXPositionInfo(positionInfo, market);

        logger.info(`  Health Factor: ${gmxPositionInfo.healthFactor.toFixed(4)}`, {
          leverage: gmxPositionInfo.leverage.toFixed(2) + 'x',
          collateralUsd: '$' + gmxPositionInfo.collateralValueUsd.toFixed(2),
          sizeUsd: '$' + gmxPositionInfo.sizeValueUsd.toFixed(2),
          liquidationPrice: '$' + gmxPositionInfo.liquidationPrice.toFixed(2),
        });

        // Categorize
        if (gmxPositionInfo.healthFactor < 1.0) {
          const profit = calculator.estimateLiquidationProfit(gmxPositionInfo);
          liquidatablePositions.push({ ...gmxPositionInfo, profit });
          logger.info(`  🎯 LIQUIDATABLE! Estimated profit: $${profit.toFixed(2)}`);
        } else if (gmxPositionInfo.healthFactor < 1.2) {
          highRiskPositions.push(gmxPositionInfo);
          logger.info('  ⚠️  HIGH RISK');
        } else if (gmxPositionInfo.healthFactor < 1.5) {
          logger.info('  ⚡ MEDIUM RISK');
        } else {
          logger.info('  ✅ SAFE');
        }

      } catch (error: any) {
        logger.debug(`  ❌ Failed to check position: ${error.message}`);
      }
    }

    // Summary
    logger.info('\n' + '='.repeat(80));
    logger.info('SCAN RESULTS');
    logger.info('='.repeat(80));

    logger.info(`\n📊 Total unique positions: ${positionMap.size}`);
    logger.info(`📊 Positions checked: ${checked}`);
    logger.info(`✅ Closed positions: ${closedPositions.length}`);
    logger.info(`🎯 LIQUIDATABLE: ${liquidatablePositions.length}`);
    logger.info(`⚠️  HIGH RISK (HF < 1.2): ${highRiskPositions.length}`);

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
scanRecentPositions()
  .then(() => {
    logger.info('Scanner finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Scanner error:', error);
    process.exit(1);
  });

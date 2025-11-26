/**
 * WebSocket Connection Test
 * Tests WebSocket connectivity, event subscription, and real-time monitoring
 */

import { loadConfig, createProvider } from '../config';
import VenusContracts from '../contracts/VenusContracts';
import EventMonitor from '../services/monitoring/EventMonitor';
import HealthFactorCalculator from '../services/monitoring/HealthFactorCalculator';
import { logger } from '../utils/logger';
import { Address } from '../types';

async function testWebSocket() {
  const config = loadConfig();

  console.log('\n🔌 Testing WebSocket Connection...\n');
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`Is WebSocket: ${config.rpcUrl.startsWith('wss://')}\n`);

  try {
    // Create provider
    console.log('⏳ Creating provider...');
    const provider = await createProvider(config.rpcUrl);
    console.log('✅ Provider created\n');

    // Test connection
    console.log('⏳ Testing network connection...');
    const network = await provider.getNetwork();
    console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})\n`);

    // Initialize Venus contracts
    console.log('⏳ Initializing Venus contracts...');
    const venusContracts = new VenusContracts(provider, config.venus.comptroller);
    await venusContracts.initialize();
    console.log(`✅ Venus contracts initialized\n`);

    // Check WebSocket status
    if (venusContracts.isWebSocketProvider()) {
      console.log('🌐 WebSocket provider detected - real-time events enabled!\n');
    } else {
      console.log('⚠️  HTTP provider detected - using polling mode\n');
    }

    // Get markets
    console.log('⏳ Loading Venus markets...');
    const markets = await venusContracts.getAllVTokens();
    console.log(`✅ Found ${markets.length} markets\n`);

    // Load known borrowers from snapshot
    let knownBorrowers: string[] = [];
    try {
      const fs = await import('fs');
      const snapshot = JSON.parse(fs.readFileSync('./healthcare_snapshot.json', 'utf-8'));
      knownBorrowers = (snapshot.borrowers || []).map((b: any) => b.address);
      console.log(`📋 Loaded ${knownBorrowers.length} known borrowers from snapshot\n`);
    } catch (e) {
      console.log('⚠️  No snapshot found, will discover borrowers from events\n');
    }

    // Setup event handlers
    const healthCalculator = new HealthFactorCalculator(venusContracts);
    let eventsReceived = 0;
    let accountsChanged = 0;

    const handleAccountDiscovered = (account: Address) => {
      console.log(`👤 New account discovered: ${account}`);
    };

    const handleHealthFactorChange = async (account: Address) => {
      eventsReceived++;
      accountsChanged++;

      try {
        const position = await healthCalculator.getPositionDetails(account);
        const preciseHF = await healthCalculator.calculatePreciseHealthFactor(account);

        const isLiquidatable = preciseHF < 1.0;
        const isCritical = preciseHF >= 1.0 && preciseHF < 1.1;
        const isHighRisk = preciseHF >= 1.1 && preciseHF < 1.3;

        if (isLiquidatable || isCritical || isHighRisk) {
          const emoji = isLiquidatable ? '💥' : isCritical ? '🔴' : '🟠';
          const status = isLiquidatable ? 'LIQUIDATABLE' : isCritical ? 'CRITICAL' : 'HIGH RISK';

          console.log(`\n${emoji} ${status} POSITION DETECTED!`);
          console.log(`   Address: ${account}`);
          console.log(`   Health Factor: ${isFinite(preciseHF) ? preciseHF.toFixed(3) : 'Infinity'}`);
          console.log(`   Debt: $${position.debtValueUsd.toFixed(2)}`);
          console.log(`   Collateral: $${position.collateralValueUsd.toFixed(2)}`);
          if (isLiquidatable) {
            console.log(`   🚨 READY FOR LIQUIDATION!\n`);
          } else {
            const distance = ((1 - 1/preciseHF) * 100).toFixed(1);
            console.log(`   Distance to liquidation: ${distance}%\n`);
          }
        }
      } catch (error) {
        logger.warn('Failed to check health factor', { account, error });
      }
    };

    // Create event monitor
    console.log('⏳ Setting up event monitor...');
    const eventMonitor = new EventMonitor(
      venusContracts,
      provider,
      handleAccountDiscovered,
      config.historicalScanWindowBlocks || 200,
      handleHealthFactorChange
    );

    await eventMonitor.start();
    console.log('✅ Event monitor started - listening for real-time events\n');

    // Monitor known borrowers for changes
    if (knownBorrowers.length > 0) {
      console.log(`🔍 Monitoring ${knownBorrowers.length} known borrowers...\n`);

      // Check critical positions immediately
      for (const address of knownBorrowers.slice(0, 5)) {
        try {
          const preciseHF = await healthCalculator.calculatePreciseHealthFactor(address);
          if (preciseHF < 1.3) {
            await handleHealthFactorChange(address);
          }
        } catch (error) {
          // Skip
        }
      }
    }

    // Keep running and show stats every 30 seconds
    console.log('📊 WebSocket test running - monitoring for events...');
    console.log('   Press Ctrl+C to stop\n');

    let lastEventCount = 0;
    setInterval(() => {
      const newEvents = eventsReceived - lastEventCount;
      lastEventCount = eventsReceived;

      console.log(`[${new Date().toLocaleTimeString()}] Events received: ${eventsReceived} total (${newEvents} in last 30s), Accounts changed: ${accountsChanged}`);
    }, 30000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n⏹️  Stopping event monitor...');
      eventMonitor.stop();
      console.log('✅ WebSocket test completed\n');
      console.log(`📊 Final stats:`);
      console.log(`   Total events received: ${eventsReceived}`);
      console.log(`   Accounts with changes: ${accountsChanged}`);
      console.log(`   Discovered accounts: ${eventMonitor.getDiscoveredAccounts().length}\n`);
      process.exit(0);
    });

  } catch (error) {
    console.error('\n❌ WebSocket test failed:', error);
    logger.error('WebSocket test failed', { error });
    process.exit(1);
  }
}

testWebSocket();

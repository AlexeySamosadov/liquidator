/**
 * Test Hybrid GMX Monitor
 * Tests the combined SDK + on-chain verification approach
 */

import { ethers } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { HybridGMXMonitor } from '../services/gmx/HybridGMXMonitor';
import { logger } from '../utils/logger';
import { GMX_ARBITRUM_ADDRESSES } from '../config/chains';

async function testHybridMonitor() {
    logger.info('='.repeat(80));
    logger.info('Testing Hybrid GMX Monitor');
    logger.info('='.repeat(80));

    const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Initialize GMX contracts
    logger.info('\n📡 Connecting to Arbitrum...');
    const network = await provider.getNetwork();
    logger.info(`Connected to chain ID: ${network.chainId}`);

    // Use Arbitrum addresses
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);

    // Create hybrid monitor
    logger.info('\n🔧 Creating Hybrid Monitor...');
    const monitor = new HybridGMXMonitor(
        provider,
        gmxContracts,
        120000 // 2 minutes refresh interval
    );

    logger.info('\n🚀 Starting monitoring (will run for 5 minutes)...\n');

    // Start monitoring
    await monitor.startMonitoring();

    // Log stats every 30 seconds
    const statsInterval = setInterval(() => {
        const stats = monitor.getStats();
        const liquidatable = monitor.getLiquidatablePositions();

        logger.info('\n📊 Current Stats:', {
            ...stats,
            topLiquidatable: liquidatable.slice(0, 3).map(p => ({
                account: p.account,
                hf: p.healthFactor.toFixed(4),
                size: `$${p.sizeUsd.toFixed(2)}`
            }))
        });
    }, 30000);

    // Run for 5 minutes
    await new Promise(resolve => setTimeout(resolve, 300000));

    // Cleanup
    clearInterval(statsInterval);
    monitor.stopMonitoring();

    // Final report
    const finalStats = monitor.getStats();
    const finalLiquidatable = monitor.getLiquidatablePositions();

    logger.info('\n' + '='.repeat(80));
    logger.info('FINAL REPORT');
    logger.info('='.repeat(80));
    logger.info('\nOverall Stats:', finalStats);
    logger.info(`\nLiquidatable Positions (${finalLiquidatable.length}):`);

    finalLiquidatable.forEach((pos, idx) => {
        logger.info(`\n${idx + 1}. Account: ${pos.account}`);
        logger.info(`   Market: ${pos.market}`);
        logger.info(`   Size: $${pos.sizeUsd.toFixed(2)}`);
        logger.info(`   Collateral: $${pos.collateralUsd.toFixed(2)}`);
        logger.info(`   Health Factor: ${pos.healthFactor.toFixed(4)}`);
        logger.info(`   ${pos.isLong ? 'LONG' : 'SHORT'}`);
    });

    logger.info('\n✅ Test complete!');
    process.exit(0);
}

testHybridMonitor().catch(error => {
    logger.error('Test failed:', error);
    process.exit(1);
});

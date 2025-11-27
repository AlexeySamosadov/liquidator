/**
 * GMX V2 Liquidation Bot Entry Point
 * 
 * Initializes the full stack:
 * 1. GMX Contracts
 * 2. Private Transaction Service (bloXroute)
 * 3. Liquidation Executor
 * 4. Hybrid Monitor (with verified data)
 */

import { ethers } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { PrivateTransactionService } from '../services/transaction/PrivateTransactionService';
import { GMXLiquidationExecutor } from '../services/gmx/GMXLiquidationExecutor';
import { HybridGMXMonitor } from '../services/gmx/HybridGMXMonitor';
import { logger } from '../utils/logger';
import { GMX_ARBITRUM_ADDRESSES } from '../config/chains';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    logger.info('================================================================================');
    logger.info('🤖 GMX V2 Liquidation Bot - STARTING');
    logger.info('================================================================================');

    // 1. Setup Provider & Wallet
    // Use NodeReal WebSocket RPC for best performance
    const rpcUrl = process.env.ARBITRUM_RPC_URL ||
                   'wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/';
    const privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
        logger.error('❌ PRIVATE_KEY not found in .env');
        process.exit(1);
    }

    let provider;
    if (rpcUrl.startsWith('wss')) {
        provider = new ethers.WebSocketProvider(rpcUrl);
    } else {
        provider = new ethers.JsonRpcProvider(rpcUrl);
    }

    const wallet = new ethers.Wallet(privateKey, provider);

    logger.info(`🔑 Wallet: ${wallet.address}`);

    const balance = await provider.getBalance(wallet.address);
    logger.info(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

    if (balance === 0n) {
        logger.warn('⚠️  Wallet has 0 ETH. Transactions will fail.');
    }

    // 2. Initialize Services
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);

    const bloXrouteConfig = {
        enabled: false, // Default to false for now unless configured
        authHeader: process.env.BLOXROUTE_AUTH_HEADER || '',
        rpcUrl: 'https://arbitrum.blxrbdn.com',
        fallbackToPublic: true
    };

    const privateTxService = new PrivateTransactionService(wallet, provider, bloXrouteConfig);

    const executor = new GMXLiquidationExecutor(
        gmxContracts,
        privateTxService,
        wallet,
        1.0, // Min profit $1
        5.0  // Max gas 5 gwei
    );

    const monitor = new HybridGMXMonitor(
        provider,
        gmxContracts,
        executor,
        60000, // 60s refresh
        true   // ENABLE EXECUTION
    );

    // 3. Start
    await monitor.startMonitoring();

    // Keep alive
    process.on('SIGINT', () => {
        logger.info('🛑 Stopping bot...');
        monitor.stopMonitoring();
        process.exit(0);
    });
}

main().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
});

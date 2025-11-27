import { GMXContracts } from '../contracts/GMXContracts';
import { GMXLiquidationExecutor } from '../services/gmx/GMXLiquidationExecutor';
import { PrivateTransactionService } from '../services/transaction/PrivateTransactionService';
import { GMXAddresses, GMXLiquidatablePosition } from '../types';

import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { loadSmallTargets, getTargetMarkets, SmallTarget } from '../config/gmxSmallTargets';
import * as dotenv from 'dotenv';

dotenv.config();

// GMX V2 contracts on Arbitrum
// const DATASTORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8'; // Now using GMXContracts
const ORACLE_ADDRESS = '0xa11B501c2dd83Acd29F6727570f2502FAaa617F2';

// DataStore ABI for position queries (unused, now using Reader)
// const datastoreAbi = [
//     'function getUint(bytes32 key) view returns (uint256)',
//     'function getAddress(bytes32 key) view returns (address)',
//     'function getBytes32(bytes32 key) view returns (bytes32)'
// ];

// Oracle events for price updates
const oracleAbi = [
    'event OraclePriceUpdate(address indexed token, uint256 minPrice, uint256 maxPrice, bool isPrimary)',
    'event PriceUpdate(bytes32 indexed token, uint256 price)'
];

// GMX V2 Arbitrum Addresses
const GMX_ARBITRUM_ADDRESSES: GMXAddresses = {
    reader: '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E', // Updated Reader
    dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    exchangeRouter: '0x7c68c7866a64fa2160f78eeae12217ffbf871fa8', // FIXED: Correct checksum
    marketFactory: '0x0000000000000000000000000000000000000000', // Placeholder
    depositVault: '0x0000000000000000000000000000000000000000'  // Placeholder
};

interface PositionHealth {
    account: string;
    market: string;
    leverage: number;
    sizeUsd: number;
    collateralUsd: number;
    currentHealth: number;
    isLiquidatable: boolean;
    pnlPercent: number;
    collateralToken: string;
    isLong: boolean;
    sizeInUsdBigInt: bigint;
    collateralAmountBigInt: bigint;
}

class WebSocketSmallTargetMonitor {
    private wsProvider: ethers.WebSocketProvider;
    private provider: ethers.JsonRpcProvider;
    private wallet: ethers.Wallet;
    // private datastore: ethers.Contract; // Now using Reader
    private oracle: ethers.Contract;
    private targets: SmallTarget[];
    private markets: string[];
    private lastCheckTime: Map<string, number>;
    private checkInterval: number = 10000; // Check every 10s max frequency per market

    // Execution services
    private gmxContracts: GMXContracts;
    private privateTxService: PrivateTransactionService;
    private executor: GMXLiquidationExecutor;

    constructor() {
        // WebSocket for real-time events (using user provided NodeReal endpoint)
        const wsUrl = 'wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/';
        this.wsProvider = new ethers.WebSocketProvider(wsUrl);

        // HTTP provider for static calls (fallback/reliability)
        this.provider = new ethers.JsonRpcProvider(
            process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
        );

        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);
        // this.datastore = new ethers.Contract(DATASTORE_ADDRESS, datastoreAbi, this.provider); // Now using Reader
        this.oracle = new ethers.Contract(ORACLE_ADDRESS, oracleAbi, this.wsProvider);

        this.targets = loadSmallTargets();
        this.markets = getTargetMarkets();
        this.lastCheckTime = new Map();

        // Initialize Execution Services
        this.gmxContracts = new GMXContracts(this.provider, GMX_ARBITRUM_ADDRESSES);

        this.privateTxService = new PrivateTransactionService(
            this.wallet,
            this.provider,
            {
                enabled: true, // Enable private transactions
                authHeader: process.env.BLOXROUTE_AUTH_HEADER || '',
                rpcUrl: 'https://virginia.rpc.blxrbdn.com',
                fallbackToPublic: true
            }
        );

        this.executor = new GMXLiquidationExecutor(
            this.gmxContracts,
            this.privateTxService,
            this.wallet,
            0.01, // Min profit $0.01 (TEST MODE - lowered for testing)
            5.0   // Max gas price 5 gwei
        );
    }

    async start() {
        logger.info('='.repeat(80));
        logger.info('🔥 WebSocket Small Target Monitor Starting...');
        logger.info('='.repeat(80));
        logger.info(`Wallet: ${this.wallet.address}`);
        logger.info(`Monitoring: ${this.targets.length} high-value small targets`);
        logger.info(`Markets: ${this.markets.length} unique markets`);
        logger.info(`WebSocket: NodeReal Premium Endpoint`);

        // Check balances
        await this.checkBalances();

        // Subscribe to real-time events
        await this.subscribeToEvents();

        // Perform initial check
        await this.checkAllTargets();

        logger.info('✅ WebSocket monitor is active and listening for events');
        logger.info('='.repeat(80));
    }

    private async checkBalances() {
        const ethBalance = await this.provider.getBalance(this.wallet.address);
        const usdcAddress = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'; // USDC.e
        const usdcAbi = ['function balanceOf(address) view returns (uint256)'];
        const usdc = new ethers.Contract(usdcAddress, usdcAbi, this.provider);
        const usdcBalance = await usdc.balanceOf(this.wallet.address);

        logger.info(`💰 ETH: ${ethers.formatEther(ethBalance)} ETH`);
        logger.info(`💰 USDC.e: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

        if (ethBalance < ethers.parseEther('0.001')) {
            logger.warn('⚠️  Low ETH balance, may not be able to execute liquidations');
        }
    }

    private async subscribeToEvents() {
        logger.info(`🔌 Subscribing to Oracle events...`);

        // Listen for Oracle price updates
        this.oracle.on('OraclePriceUpdate', async (token) => {
            // Rate limit checks per token/market
            const now = Date.now();
            const lastCheck = this.lastCheckTime.get(token) || 0;

            if (now - lastCheck > this.checkInterval) {
                this.lastCheckTime.set(token, now);
                // Find markets using this token and check them
                // For simplicity in this small script, we'll check all targets if we get a price update
                await this.checkAllTargets();
            }
        });

        // Also subscribe to new blocks as a heartbeat
        this.wsProvider.on('block', async (blockNumber) => {
            if (blockNumber % 10 === 0) { // Log every 10th block to reduce noise
                logger.info(`📦 New block: ${blockNumber}`);
            }
        });

        logger.info('✅ Subscribed to OraclePriceUpdate and block events');
    }

    private async checkAllTargets(): Promise<void> {
        try {
            const healthStatuses: PositionHealth[] = [];

            // Check each target position
            for (const target of this.targets) {
                try {
                    const health = await this.checkPositionHealth(target);
                    healthStatuses.push(health);
                } catch (error) {
                    continue;
                }
            }

            // Filter liquidatable positions
            const liquidatable = healthStatuses.filter(h => h.isLiquidatable);
            const atRisk = healthStatuses.filter(h => !h.isLiquidatable && h.currentHealth < 1.5);

            if (liquidatable.length > 0) {
                logger.info('');
                logger.info('🚨 LIQUIDATABLE POSITIONS FOUND! 🚨');
                logger.info('='.repeat(80));

                // Sort by smallest collateral (easiest first)
                liquidatable.sort((a, b) => a.collateralUsd - b.collateralUsd);

                for (const pos of liquidatable) {
                    logger.info(
                        `⚔️ EXECUTING LIQUIDATION: ${pos.account.slice(0, 10)}... | ` +
                        `Market: ${pos.market.slice(0, 10)}... | ` +
                        `Size: $${pos.sizeUsd.toFixed(0)} | ` +
                        `Health: ${pos.currentHealth.toFixed(2)}`
                    );

                    await this.executeLiquidation(pos);
                }

                logger.info('='.repeat(80));

            } else if (atRisk.length > 0) {
                logger.info(`⚠️  ${atRisk.length} positions at risk (health < 1.5), watching closely...`);
            } else {
                logger.info(`✅ All ${healthStatuses.length} positions healthy (checked at ${new Date().toLocaleTimeString()})`);
            }

        } catch (error) {
            logger.error('Error checking targets:', error);
        }
    }

    private async executeLiquidation(pos: PositionHealth): Promise<void> {
        try {
            // Fetch market info (needed for execution)
            const reader = this.gmxContracts.getReader();
            const dataStore = this.gmxContracts.getDataStoreAddress();
            const marketInfo = await reader.getMarket(dataStore, pos.market);

            // Construct GMXLiquidatablePosition
            const liquidatablePos: GMXLiquidatablePosition = {
                position: {
                    account: pos.account,
                    market: pos.market,
                    collateralToken: pos.collateralToken,
                    isLong: pos.isLong,
                    sizeInUsd: pos.sizeInUsdBigInt,
                    sizeInTokens: 0n, // Not strictly needed for liquidation
                    collateralAmount: pos.collateralAmountBigInt,
                    borrowingFactor: 0n,
                    fundingFeeAmountPerSize: 0n,
                    longTokenClaimableFundingAmountPerSize: 0n,
                    shortTokenClaimableFundingAmountPerSize: 0n,
                    increasedAtBlock: 0n,
                    decreasedAtBlock: 0n
                },
                marketInfo: {
                    marketToken: pos.market,
                    indexToken: marketInfo.indexToken,
                    longToken: marketInfo.longToken,
                    shortToken: marketInfo.shortToken,
                    marketName: 'Target Market'
                },
                healthFactor: pos.currentHealth,
                sizeValueUsd: pos.sizeUsd,
                collateralValueUsd: pos.collateralUsd,
                estimatedProfitUsd: pos.collateralUsd * 0.01, // Rough estimate
                gasEstimate: 3000000n,
                leverage: pos.leverage,
                liquidationPrice: 0,
                unrealizedPnlUsd: 0,
                lastUpdated: Date.now()
            };

            logger.info(`⚡ Calling Executor for ${pos.account}...`);
            const result = await this.executor.liquidate(liquidatablePos);

            if (result.success) {
                logger.info(`✅ Liquidation executed! Tx: ${result.txHash}`);
            } else {
                logger.error(`❌ Liquidation failed: ${result.error}`);
            }

        } catch (error) {
            logger.error(`Failed to execute liquidation for ${pos.account}`, error);
        }
    }

    private async checkPositionHealth(target: SmallTarget): Promise<PositionHealth> {
        // Build position key
        const positionKey = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'address', 'bool'],
                [target.account, target.market, target.collateralToken, target.isLong]
            )
        );

        // Use Reader to get position info (Robust method)
        const reader = this.gmxContracts.getReader();
        const dataStoreAddress = this.gmxContracts.getDataStoreAddress();

        // Reader.getPosition returns the Position struct directly (as a Result object)
        const position = await reader.getPosition(dataStoreAddress, positionKey);

        const sizeInUsd = position.sizeInUsd;
        const collateralAmount = position.collateralAmount;

        // If position is closed, throw error to skip
        if (sizeInUsd === 0n) {
            throw new Error('Position closed');
        }

        // Calculate current health
        // Health = (Collateral + PnL) / (Size * LiquidationThreshold)
        // Simplified: assume collateral in USDC (6 decimals)
        const sizeUsd = Number(ethers.formatUnits(sizeInUsd, 30));
        const collateralUsd = Number(ethers.formatUnits(collateralAmount, 6));
        const leverage = sizeUsd / collateralUsd;

        // Mock PnL calculation (in reality, need to fetch current prices and calculate)
        // For now, assume small negative PnL based on leverage
        const estimatedPnlPercent = -2; // -2% loss estimate
        const pnlUsd = collateralUsd * (estimatedPnlPercent / 100);

        const totalValue = collateralUsd + pnlUsd;
        const liquidationThreshold = 0.02; // 2% (GMX default)
        const healthFactor = totalValue / (sizeUsd * liquidationThreshold);

        return {
            account: target.account,
            market: target.market,
            leverage,
            sizeUsd,
            collateralUsd,
            currentHealth: healthFactor,
            isLiquidatable: healthFactor < 1.0,
            pnlPercent: estimatedPnlPercent,
            collateralToken: target.collateralToken,
            isLong: target.isLong,
            sizeInUsdBigInt: sizeInUsd,
            collateralAmountBigInt: collateralAmount,
        };
    }

    async shutdown() {
        logger.info('Shutting down monitor...');
        if (this.wsProvider) {
            await this.wsProvider.destroy();
        }
        process.exit(0);
    }
}

async function main() {
    const monitor = new WebSocketSmallTargetMonitor();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        logger.info('\nReceived SIGINT, shutting down...');
        await monitor.shutdown();
    });

    process.on('SIGTERM', async () => {
        logger.info('\nReceived SIGTERM, shutting down...');
        await monitor.shutdown();
    });

    await monitor.start();
}

main().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
});

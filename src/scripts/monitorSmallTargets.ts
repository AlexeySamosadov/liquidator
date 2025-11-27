/**
 * Focused monitoring for 31 small liquidation targets
 * Optimized for limited capital (~$40 balance)
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { loadSmallTargets, getTargetMarkets, SmallTarget } from '../config/gmxSmallTargets';
import * as dotenv from 'dotenv';

dotenv.config();

// GMX V2 contracts on Arbitrum
const DATASTORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';
const READER_ADDRESS = '0xf60becbba223EEA9495Da3f606753867eC10d139';
const EXCHANGE_ROUTER_ADDRESS = '0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8';

// Oracle contract for price feeds
const ORACLE_ADDRESS = '0xa11B501c2dd83Acd29F6727570f2502FAaa617F2';

// DataStore ABI (for keys)
const datastoreAbi = [
    'function getUint(bytes32 key) view returns (uint256)',
    'function getAddress(bytes32 key) view returns (address)',
    'function getBool(bytes32 key) view returns (bool)'
];

// Reader ABI
const readerAbi = [
    'function getPositionInfo(address dataStore, address referralStorage, bytes32 positionKey, tuple(uint256 minPrice, uint256 maxPrice)[] prices) view returns (tuple(tuple(address account, address market, address collateralToken, uint256 sizeInUsd, uint256 sizeInTokens, uint256 collateralAmount, uint256 borrowingFactor, uint256 fundingFeeAmountPerSize, uint256 longTokenClaimableFundingAmountPerSize, uint256 shortTokenClaimableFundingAmountPerSize, bool isLong) position, tuple(int256 pnl, int256 pnlAfterPriceImpact, uint256 executionPrice) executionPriceResult, int256 basePnlUsd, int256 pnlAfterPriceImpactUsd) info)'
];

// ExchangeRouter ABI (for liquidation)
const exchangeRouterAbi = [
    'function createOrder(tuple(address[] addresses, uint256[] numbers, bytes32 orderType, uint256 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode) params) payable returns (bytes32)'
];

interface PriceData {
    minPrice: bigint;
    maxPrice: bigint;
}

interface PositionHealth {
    target: SmallTarget;
    healthFactor: number;
    isLiquidatable: boolean;
    pnl: bigint;
    executionPrice: bigint;
}

class SmallTargetMonitor {
    private provider: ethers.JsonRpcProvider;
    private wallet: ethers.Wallet;
    private datastore: ethers.Contract;
    private reader: ethers.Contract;
    private exchangeRouter: ethers.Contract;
    private targets: SmallTarget[];
    private priceCache: Map<string, PriceData>;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);
        this.datastore = new ethers.Contract(DATASTORE_ADDRESS, datastoreAbi, this.provider);
        this.reader = new ethers.Contract(READER_ADDRESS, readerAbi, this.provider);
        this.exchangeRouter = new ethers.Contract(EXCHANGE_ROUTER_ADDRESS, exchangeRouterAbi, this.wallet);
        this.targets = loadSmallTargets();
        this.priceCache = new Map();
    }

    async start() {
        logger.info('='.repeat(80));
        logger.info('Small Liquidation Target Monitor Starting...');
        logger.info('='.repeat(80));
        logger.info(`Wallet: ${this.wallet.address}`);
        logger.info(`Monitoring: ${this.targets.length} small targets`);
        logger.info(`Markets: ${getTargetMarkets().length} unique markets`);

        // Check balance
        const balance = await this.provider.getBalance(this.wallet.address);
        const usdcAddress = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'; // USDC.e
        const usdcAbi = ['function balanceOf(address) view returns (uint256)'];
        const usdc = new ethers.Contract(usdcAddress, usdcAbi, this.provider);
        const usdcBalance = await usdc.balanceOf(this.wallet.address);

        logger.info(`ETH Balance: ${ethers.formatEther(balance)} ETH`);
        logger.info(`USDC.e Balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
        logger.info('='.repeat(80));

        // Start monitoring loop
        await this.monitoringLoop();
    }

    private async monitoringLoop() {
        let iteration = 0;

        while (true) {
            try {
                iteration++;
                logger.info(`\n[Iteration ${iteration}] Checking ${this.targets.length} targets...`);

                const healthChecks = await this.checkAllTargets();
                const liquidatable = healthChecks.filter(h => h.isLiquidatable);

                if (liquidatable.length > 0) {
                    logger.info(`🚨 Found ${liquidatable.length} liquidatable positions!`);

                    // Sort by smallest collateral (easiest to liquidate)
                    liquidatable.sort((a, b) => a.target.collateralUsd - b.target.collateralUsd);

                    for (const target of liquidatable) {
                        logger.info(
                            `  💰 ${target.target.account.slice(0, 10)}... | ` +
                            `Health: ${target.healthFactor.toFixed(2)} | ` +
                            `Collateral: $${target.target.collateralUsd.toFixed(0)} | ` +
                            `Leverage: ${target.target.leverage.toFixed(1)}x`
                        );
                    }

                    // TODO: Implement liquidation execution logic
                    logger.info('⚠️  Liquidation execution not yet implemented');
                } else {
                    logger.info(`✅ No liquidatable positions found`);
                }

                // Wait 30 seconds before next check
                await new Promise(resolve => setTimeout(resolve, 30000));

            } catch (error) {
                logger.error(`Error in monitoring loop:`, error);
                await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 min on error
            }
        }
    }

    private async checkAllTargets(): Promise<PositionHealth[]> {
        const results: PositionHealth[] = [];

        for (const target of this.targets) {
            try {
                const health = await this.checkPositionHealth(target);
                results.push(health);
            } catch (error) {
                // Skip if position check fails (may be already closed)
                continue;
            }
        }

        return results;
    }

    private async checkPositionHealth(target: SmallTarget): Promise<PositionHealth> {
        // Build position key
        const positionKey = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'address', 'bool'],
                [target.account, target.market, target.collateralToken, target.isLong]
            )
        );

        // Get position info from Reader
        const priceData = await this.getPriceData(target.market);
        const prices = [priceData]; // Single price for now

        const positionInfo = await this.reader.getPositionInfo(
            DATASTORE_ADDRESS,
            ethers.ZeroAddress, // referralStorage (not needed for health check)
            positionKey,
            prices
        );

        const position = positionInfo.position;
        const pnl = positionInfo.pnlAfterPriceImpactUsd;
        const executionPrice = positionInfo.executionPriceResult.executionPrice;

        // Calculate health factor
        // Health = (Collateral + PnL) / (Size * LiquidationThreshold)
        // If health < 1.0, position is liquidatable
        const collateral = Number(ethers.formatUnits(position.collateralAmount, 6)); // Assuming USDC
        const size = Number(ethers.formatUnits(position.sizeInUsd, 30));
        const pnlUsd = Number(ethers.formatUnits(pnl, 30));

        const totalValue = collateral + pnlUsd;
        const liquidationThreshold = 0.02; // 2% (GMX threshold)
        const healthFactor = totalValue / (size * liquidationThreshold);

        return {
            target,
            healthFactor,
            isLiquidatable: healthFactor < 1.0,
            pnl: pnl,
            executionPrice: executionPrice
        };
    }

    private async getPriceData(market: string): Promise<PriceData> {
        // Check cache first (valid for 10 seconds)
        const cached = this.priceCache.get(market);
        if (cached) {
            return cached;
        }

        // Fetch current market price
        // For now, return mock prices (TODO: integrate Oracle)
        const mockPrice = ethers.parseUnits('1800', 12); // $1800 for ETH
        const priceData = {
            minPrice: mockPrice,
            maxPrice: mockPrice
        };

        this.priceCache.set(market, priceData);
        setTimeout(() => this.priceCache.delete(market), 10000); // Expire after 10s

        return priceData;
    }
}

async function main() {
    const monitor = new SmallTargetMonitor();
    await monitor.start();
}

main().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
});

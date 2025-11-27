/**
 * Hybrid GMX Monitoring Service
 * Combines SDK position discovery with on-chain verification
 */

import { ethers } from 'ethers';
import { GMXContracts } from '../../contracts/GMXContracts';
import { logger } from '../../utils/logger';
import { SDKPosition } from '../../scripts/scanGMXWithSDK';
import { Address } from '../../types';
import { PositionStruct, Market } from '../../contracts/interfaces/IGMXReader';
import { PriceService } from './PriceService';
import { GMXLiquidationExecutor } from './GMXLiquidationExecutor';
import { GMXLiquidatablePosition } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

export interface VerifiedPosition {
    account: Address;
    market: Address;
    collateralToken: Address;
    isLong: boolean;
    sdkData: SDKPosition;
    onChainData: PositionStruct | null;
    verified: boolean;
    sizeUsd: number;
    collateralUsd: number;
    healthFactor: number;
}

export class HybridGMXMonitor {
    private priceService: PriceService;
    private marketCache: Map<string, Market> = new Map();
    private monitoringInterval: NodeJS.Timeout | null = null;
    private verifiedPositions: Map<string, VerifiedPosition> = new Map();

    constructor(
        _provider: ethers.JsonRpcProvider | ethers.WebSocketProvider,
        private readonly gmxContracts: GMXContracts,
        private readonly executor: GMXLiquidationExecutor,
        private readonly refreshIntervalMs: number = 60000, // 1 minute default
        private readonly enableExecution: boolean = false
    ) {
        this.priceService = new PriceService();
    }

    /**
     * Start hybrid monitoring: SDK discovery + on-chain verification
     */
    async startMonitoring(): Promise<void> {
        logger.info('🚀 Starting Hybrid GMX Monitor...');
        logger.info(`🔫 Execution Enabled: ${this.enableExecution}`);

        // Initial scan
        await this.scanAndVerify();

        // Set up periodic monitoring
        this.monitoringInterval = setInterval(async () => {
            await this.scanAndVerify();
        }, this.refreshIntervalMs);

        logger.info(`✅ Hybrid monitoring started (refresh: ${this.refreshIntervalMs}ms)`);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            logger.info('⏹️  Hybrid monitoring stopped');
        }
    }

    /**
     * Main scan and verify loop
     */
    private async scanAndVerify(): Promise<void> {
        try {
            logger.info('🔍 Starting scan cycle...');

            // Step 0: Update prices
            await this.priceService.updatePrices();

            // Step 1: Load Verified Positions from JSON
            // We use the verified list as our source of truth
            const dataFile = path.join(__dirname, '../../../data/gmx_verified_positions.json');
            if (!fs.existsSync(dataFile)) {
                logger.error('Verified positions file not found. Run "npm run gmx:scan-all" first.');
                return;
            }

            const verifiedPositionsRaw = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
            logger.info(`📊 Loaded ${verifiedPositionsRaw.length} verified positions from JSON`);

            // Step 2: Verify each position on-chain (Double check before liquidation)
            let verifiedCount = 0;
            let liquidatableCount = 0;

            // We process in batches to avoid congestion
            const batchSize = 1; // Serial execution to avoid RPC issues
            for (let i = 0; i < verifiedPositionsRaw.length; i += batchSize) {
                const batch = verifiedPositionsRaw.slice(i, i + batchSize);

                await Promise.all(batch.map(async (pos: any) => {
                    try {
                        const account = pos.account;
                        const market = pos.market;
                        const collateralToken = pos.collateralToken;
                        const isLong = pos.isLong;

                        // Check liquidation status on-chain
                        const result = await this.checkLiquidationStatus(account, market, collateralToken, isLong);

                        if (result) {
                            verifiedCount++;

                            if (result.isLiquidatable) {
                                liquidatableCount++;
                                logger.info(`🚨 CONFIRMED LIQUIDATABLE: ${account}`, {
                                    market,
                                    hf: result.healthFactor.toFixed(4),
                                    collateralUsd: result.collateralUsd.toFixed(2),
                                    reason: result.reason
                                });

                                if (this.enableExecution) {
                                    // Construct GMXLiquidatablePosition object
                                    const liquidatablePos: GMXLiquidatablePosition = {
                                        position: {
                                            account,
                                            market,
                                            collateralToken,
                                            isLong,
                                            sizeInUsd: BigInt(pos.sizeInUsd) * BigInt(1e30),
                                            sizeInTokens: BigInt(0),
                                            collateralAmount: BigInt(0),
                                            borrowingFactor: BigInt(0),
                                            fundingFeeAmountPerSize: BigInt(0),
                                            longTokenClaimableFundingAmountPerSize: BigInt(0),
                                            shortTokenClaimableFundingAmountPerSize: BigInt(0),
                                            increasedAtBlock: BigInt(0),
                                            decreasedAtBlock: BigInt(0)
                                        },
                                        marketInfo: {
                                            marketToken: market,
                                            indexToken: '0x0000000000000000000000000000000000000000',
                                            longToken: '0x0000000000000000000000000000000000000000',
                                            shortToken: '0x0000000000000000000000000000000000000000',
                                            marketName: 'Unknown Market'
                                        },
                                        healthFactor: result.healthFactor,
                                        sizeValueUsd: result.sizeUsd,
                                        collateralValueUsd: result.collateralUsd,
                                        estimatedProfitUsd: result.collateralUsd * 0.01,
                                        gasEstimate: BigInt(3000000), // Estimate
                                        leverage: 0,
                                        liquidationPrice: 0,
                                        unrealizedPnlUsd: 0,
                                        lastUpdated: Date.now()
                                    };

                                    // EXECUTE
                                    await this.executor.liquidate(liquidatablePos);
                                }
                            }
                        }
                    } catch (e) {
                        logger.error(`Error checking position ${pos.account}`, e);
                    }
                }));

                // Rate limit
                await this.sleep(100);
            }

            logger.info(`✅ Cycle complete:`, {
                verified: verifiedCount,
                liquidatable: liquidatableCount
            });

        } catch (error) {
            logger.error('Scan cycle failed:', error);
        }
    }

    /**
     * Check single position status
     */
    private async checkLiquidationStatus(
        account: string,
        market: string,
        collateralToken: string,
        isLong: boolean
    ): Promise<{ isLiquidatable: boolean, healthFactor: number, collateralUsd: number, sizeUsd: number, reason: string } | null> {
        try {
            // Get market details (cached)
            let marketInfo = this.marketCache.get(market.toLowerCase());
            if (!marketInfo) {
                const reader = this.gmxContracts.getReader();
                const dataStore = this.gmxContracts.getDataStoreAddress();
                try {
                    marketInfo = await this.getMarketWithRetry(reader, dataStore, market);
                    if (marketInfo) {
                        this.marketCache.set(market.toLowerCase(), marketInfo);
                    }
                } catch (marketError) {
                    logger.error(`Failed to fetch market info for market ${market}`, marketError);
                    return null; // Skip this position if market info cannot be fetched
                }
            }

            if (!marketInfo) return null;

            // Get prices
            const prices = this.priceService.getMarketPrices(
                marketInfo.indexToken,
                marketInfo.longToken,
                marketInfo.shortToken
            );

            // Check liquidation
            const reader = this.gmxContracts.getReader();
            const dataStore = this.gmxContracts.getDataStoreAddress();
            const referralStorage = this.gmxContracts.getReferralStorageAddress();
            const positionKey = this.getPositionKey(account, market, collateralToken, isLong);

            // Create mutable copy of market to avoid "read-only property" error
            const mutableMarket = {
                marketToken: marketInfo.marketToken,
                indexToken: marketInfo.indexToken,
                longToken: marketInfo.longToken,
                shortToken: marketInfo.shortToken
            };

            const [isLiquidatable, reason, info] = await reader.isPositionLiquidatable(
                dataStore,
                referralStorage,
                positionKey,
                mutableMarket,
                prices,
                true
            );

            const collateralUsd = Number(ethers.formatUnits(info.collateralUsd, 30));
            const minCollateralUsd = Number(ethers.formatUnits(info.minCollateralUsd, 30));
            // Note: info doesn't return sizeUsd directly in all Reader versions, 
            // but we can infer HF.

            let healthFactor = 999;
            if (isLiquidatable) {
                healthFactor = collateralUsd > 0 ? (collateralUsd / minCollateralUsd) : 0;
                if (healthFactor >= 1.0) healthFactor = 0.99;
            } else {
                healthFactor = minCollateralUsd > 0 ? (collateralUsd / minCollateralUsd) : 999;
            }

            return {
                isLiquidatable,
                healthFactor,
                collateralUsd,
                sizeUsd: 0, // We'd need to fetch position struct for this, skipping for speed
                reason
            };

        } catch (err) {
            logger.error(`Failed to check liquidation status for ${account}`, err);
            return null;
        }
    }

    /**
     * Get position key
     */
    private getPositionKey(
        account: Address,
        market: Address,
        collateralToken: Address,
        isLong: boolean
    ): string {
        return ethers.solidityPackedKeccak256(
            ['address', 'address', 'address', 'bool'],
            [account, market, collateralToken, isLong]
        );
    }

    /**
     * Get all verified positions
     */
    getVerifiedPositions(): VerifiedPosition[] {
        return Array.from(this.verifiedPositions.values());
    }

    /**
     * Get liquidatable positions
     */
    getLiquidatablePositions(maxHealthFactor: number = 1.0): VerifiedPosition[] {
        return this.getVerifiedPositions()
            .filter(pos => pos.healthFactor <= maxHealthFactor && pos.sizeUsd > 0)
            .sort((a, b) => a.healthFactor - b.healthFactor);
    }

    /**
     * Get monitoring stats
     */
    getStats() {
        const positions = this.getVerifiedPositions();
        const liquidatable = this.getLiquidatablePositions(1.1);

        return {
            totalVerified: positions.length,
            liquidatable: liquidatable.length,
            totalSizeUsd: positions.reduce((sum, p) => sum + p.sizeUsd, 0),
            avgHealthFactor: positions.length > 0
                ? positions.reduce((sum, p) => sum + p.healthFactor, 0) / positions.length
                : 0
        };
    }

    private async getMarketWithRetry(reader: any, dataStore: string, market: string, retries = 3): Promise<any> {
        const cleanDataStore = dataStore.trim();
        const cleanMarket = market.trim();

        // logger.info(`Calling getMarket with: dataStore=${cleanDataStore}, market=${cleanMarket}`);

        for (let i = 0; i < retries; i++) {
            try {
                return await reader.getMarket(cleanDataStore, cleanMarket);
            } catch (error) {
                if (i === retries - 1) throw error;
                // Add a delay between accounts to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

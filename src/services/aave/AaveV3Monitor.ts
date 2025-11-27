import { ethers } from 'ethers';
import { AAVE_V3_POOL_ABI, AAVE_V3_ARBITRUM, HEALTH_FACTOR_LIQUIDATION_THRESHOLD } from '../../contracts/abis/AaveV3Pool';

export interface UserAccountData {
    totalCollateralBase: bigint;
    totalDebtBase: bigint;
    availableBorrowsBase: bigint;
    currentLiquidationThreshold: bigint;
    ltv: bigint;
    healthFactor: bigint;
}

export interface LiquidatablePosition {
    user: string;
    healthFactor: bigint;
    totalCollateralBase: bigint;
    totalDebtBase: bigint;
    estimatedProfit: bigint;
    liquidationBonus: number; // percentage
}

export class AaveV3Monitor {
    private provider: ethers.providers.JsonRpcProvider;
    private poolContract: ethers.Contract;

    constructor(providerUrl: string) {
        this.provider = new ethers.providers.JsonRpcProvider(providerUrl);
        this.poolContract = new ethers.Contract(
            AAVE_V3_ARBITRUM.POOL,
            AAVE_V3_POOL_ABI,
            this.provider
        );
    }

    /**
     * Check if a user's position is liquidatable
     */
    async getUserAccountData(userAddress: string): Promise<UserAccountData> {
        const data = await this.poolContract.getUserAccountData(userAddress);

        // Ethers v5 returns BigNumber, need to convert to native bigint
        return {
            totalCollateralBase: data.totalCollateralBase.toBigInt(),
            totalDebtBase: data.totalDebtBase.toBigInt(),
            availableBorrowsBase: data.availableBorrowsBase.toBigInt(),
            currentLiquidationThreshold: data.currentLiquidationThreshold.toBigInt(),
            ltv: data.ltv.toBigInt(),
            healthFactor: data.healthFactor.toBigInt()
        };
    }

    /**
     * Check if position is liquidatable
     */
    isLiquidatable(accountData: UserAccountData): boolean {
        // Convert threshold to BigInt for comparison
        return accountData.healthFactor < BigInt(HEALTH_FACTOR_LIQUIDATION_THRESHOLD);
    }

    /**
     * Check if can liquidate 100% (HF < 0.95)
     */
    canLiquidate100Percent(accountData: UserAccountData): boolean {
        // 0.95 * 10^18 = 950000000000000000
        const threshold95 = BigInt("950000000000000000");
        return accountData.healthFactor < threshold95;
    }

    /**
     * Calculate maximum debt that can be liquidated
     */
    calculateMaxLiquidatableDebt(accountData: UserAccountData): bigint {
        if (this.canLiquidate100Percent(accountData)) {
            // Can liquidate 100%
            return accountData.totalDebtBase;
        } else {
            // Can liquidate 50%
            return accountData.totalDebtBase / BigInt(2);
        }
    }

    /**
     * Estimate profit from liquidation
     * Assumes 10% liquidation bonus (actual varies by asset)
     */
    estimateProfit(
        debtToRepay: bigint,
        liquidationBonusPercent: number = 10
    ): { grossProfit: bigint; netProfit: bigint } {
        const bonusMultiplier = BigInt(100 + liquidationBonusPercent);
        const collateralReceived = (debtToRepay * bonusMultiplier) / BigInt(100);
        const grossProfit = collateralReceived - debtToRepay;

        // Subtract flash loan fee (0.09%)
        // AAVE_V3_ARBITRUM constants are already BigInt
        const flashLoanFee = (debtToRepay * AAVE_V3_ARBITRUM.FLASH_LOAN_FEE_PERCENTAGE) /
            AAVE_V3_ARBITRUM.FLASH_LOAN_FEE_DIVISOR;

        // Subtract estimated gas (in USD, approximate)
        // Arbitrum gas is very cheap: ~$0.001 per transaction (base price 0.01 gwei)
        const estimatedGasUSD = BigInt("1000000000000000"); // $0.001 in base units (18 decimals)

        const netProfit = grossProfit - flashLoanFee - estimatedGasUSD;

        return { grossProfit, netProfit };
    }

    /**
     * Monitor a list of users and find liquidatable positions
     */
    async findLiquidatablePositions(
        userAddresses: string[],
        minProfitUSD: bigint = BigInt("100000000000000000") // $0.10 minimum for testing
    ): Promise<LiquidatablePosition[]> {
        const liquidatable: LiquidatablePosition[] = [];

        for (const user of userAddresses) {
            try {
                const accountData = await this.getUserAccountData(user);

                if (!this.isLiquidatable(accountData)) {
                    continue;
                }

                const maxDebt = this.calculateMaxLiquidatableDebt(accountData);
                const { netProfit } = this.estimateProfit(maxDebt);

                if (netProfit < minProfitUSD) {
                    console.log(`User ${user} liquidatable but profit too low: ${ethers.utils.formatEther(netProfit)}`);
                    continue;
                }

                liquidatable.push({
                    user,
                    healthFactor: accountData.healthFactor,
                    totalCollateralBase: accountData.totalCollateralBase,
                    totalDebtBase: accountData.totalDebtBase,
                    estimatedProfit: netProfit,
                    liquidationBonus: 10 // Default, should be fetched per asset
                });

                console.log(`✅ Found liquidatable position!`);
                console.log(`   User: ${user}`);
                console.log(`   Health Factor: ${ethers.utils.formatEther(accountData.healthFactor)}`);
                console.log(`   Estimated Profit: $${ethers.utils.formatEther(netProfit)}`);
            } catch (error) {
                console.error(`Error checking user ${user}:`, error);
            }
        }

        // Sort by profit (highest first)
        return liquidatable.sort((a, b) =>
            Number(b.estimatedProfit - a.estimatedProfit)
        );
    }

    /**
     * Get list of all borrowers (placeholder - needs subgraph or event scanning)
     * TODO: Implement using Aave V3 subgraph or by scanning Borrow events
     */
    async getAllBorrowers(): Promise<string[]> {
        // This is a placeholder
        // Real implementation should:
        // 1. Query Aave V3 subgraph for all users with debt > 0
        // 2. Or scan Borrow events from Pool contract
        console.warn('getAllBorrowers not implemented - using empty list');
        return [];
    }
}

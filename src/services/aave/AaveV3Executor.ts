import { ethers, Wallet, Contract } from "ethers";

/**
 * Executor service for FlashLiquidator contract
 * Calls the deployed contract to execute flash loan liquidations
 */
export class AaveV3Executor {
    private contract: Contract;
    private wallet: Wallet;

    // FlashLiquidator ABI - only the functions we need
    private static readonly ABI = [
        "function executeLiquidation(address user, address debtAsset, address collateralAsset, uint256 debtToCover, uint24 poolFee) external",
        "function owner() external view returns (address)",
        "function withdraw(address token) external"
    ];

    constructor(
        contractAddress: string,
        privateKey: string,
        rpcUrl: string
    ) {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        this.wallet = new Wallet(privateKey, provider);
        this.contract = new Contract(contractAddress, AaveV3Executor.ABI, this.wallet);
    }

    /**
     * Execute a flash loan liquidation
     * @param user Address of user to liquidate
     * @param debtAsset Address of debt token (e.g., USDC)
     * @param collateralAsset Address of collateral token (e.g., WETH)
     * @param debtToCover Amount of debt to cover (in debt asset decimals)
     * @param poolFee Uniswap V3 pool fee (500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
     */
    async executeLiquidation(
        user: string,
        debtAsset: string,
        collateralAsset: string,
        debtToCover: bigint,
        poolFee: number = 3000
    ): Promise<ethers.ContractTransaction> {
        console.log("\n🔥 Executing Flash Loan Liquidation...");
        console.log("User:", user);
        console.log("Debt Asset:", debtAsset);
        console.log("Collateral Asset:", collateralAsset);
        console.log("Debt to Cover:", debtToCover.toString());
        console.log("Pool Fee:", poolFee);

        try {
            // Estimate gas
            const gasEstimate = await this.contract.estimateGas.executeLiquidation(
                user,
                debtAsset,
                collateralAsset,
                debtToCover,
                poolFee
            );

            console.log("Estimated Gas:", gasEstimate.toString());

            // Execute with 20% gas buffer
            const tx = await this.contract.executeLiquidation(
                user,
                debtAsset,
                collateralAsset,
                debtToCover,
                poolFee,
                {
                    gasLimit: gasEstimate.mul(120).div(100)
                }
            );

            console.log("Transaction sent:", tx.hash);
            console.log("Waiting for confirmation...");

            const receipt = await tx.wait();
            console.log("✅ Transaction confirmed!");
            console.log("Gas used:", receipt.gasUsed.toString());

            return tx;
        } catch (error: any) {
            console.error("❌ Liquidation failed:", error.message);
            throw error;
        }
    }

    /**
     * Simulate liquidation without executing
     * Useful for testing profitability before execution
     */
    async simulateLiquidation(
        user: string,
        debtAsset: string,
        collateralAsset: string,
        debtToCover: bigint,
        poolFee: number = 3000
    ): Promise<boolean> {
        try {
            // Just estimate gas - if it fails, liquidation won't work
            await this.contract.estimateGas.executeLiquidation(
                user,
                debtAsset,
                collateralAsset,
                debtToCover,
                poolFee
            );
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get contract owner (should be your wallet)
     */
    async getOwner(): Promise<string> {
        return await this.contract.owner();
    }

    /**
     * Emergency withdraw stuck tokens
     */
    async withdrawToken(tokenAddress: string): Promise<ethers.ContractTransaction> {
        const tx = await this.contract.withdraw(tokenAddress);
        await tx.wait();
        return tx;
    }

    /**
     * Get wallet address
     */
    getWalletAddress(): string {
        return this.wallet.address;
    }
}

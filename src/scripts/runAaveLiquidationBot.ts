import { AaveV3Monitor } from "../services/aave/AaveV3Monitor";
import { AaveV3Subgraph } from "../services/aave/AaveV3Subgraph";
import { AaveV3Executor } from "../services/aave/AaveV3Executor";
import dotenv from "dotenv";

dotenv.config();

// Configuration
const ARBITRUM_RPC = process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const FLASH_LIQUIDATOR_ADDRESS = "0x9a55132AA9C800A81f73eB24C9732d52Aa3eced4";

// Arbitrum token addresses
const TOKENS = {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC native
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548"
};

/**
 * Main bot that monitors Aave V3 and executes profitable liquidations
 */
async function runLiquidationBot() {
    console.log("\n🤖 Aave V3 Liquidation Bot Starting...\n");
    console.log("=".repeat(60));

    // Initialize services
    const subgraph = new AaveV3Subgraph();
    const monitor = new AaveV3Monitor(ARBITRUM_RPC);
    const executor = new AaveV3Executor(
        FLASH_LIQUIDATOR_ADDRESS,
        PRIVATE_KEY,
        ARBITRUM_RPC
    );

    console.log("Bot Address:", executor.getWalletAddress());
    console.log("FlashLiquidator:", FLASH_LIQUIDATOR_ADDRESS);
    console.log("=".repeat(60));

    try {
        // Step 1: Get borrowers from subgraph
        console.log("\n1️⃣ Fetching borrowers from subgraph...");
        const borrowers = await subgraph.getLowHealthFactorUsers();
        console.log(`Found ${borrowers.length} borrowers with active debt`);

        if (borrowers.length === 0) {
            console.log("No borrowers found. Exiting.");
            return;
        }

        // Step 2: Check health factors on-chain
        console.log("\n2️⃣ Checking health factors on-chain...");
        const liquidatable = await monitor.findLiquidatablePositions(
            borrowers.map(b => b.address),
            BigInt(50e18) // Min $50 profit
        );

        console.log(`Found ${liquidatable.length} liquidatable positions`);

        if (liquidatable.length === 0) {
            console.log("No profitable liquidations found. Exiting.");
            return;
        }

        // Step 3: Execute liquidations (one at a time for safety)
        console.log("\n3️⃣ Executing liquidations...\n");

        for (const position of liquidatable.slice(0, 3)) {
            console.log("\n" + "─".repeat(60));
            console.log("Position:", position.user);
            console.log("Health Factor:", (Number(position.healthFactor) / 1e18).toFixed(4));
            console.log("Estimated Profit:", `$${(Number(position.estimatedProfit) / 1e18).toFixed(2)}`);

            // Determine debt and collateral assets
            // For now, assume USDC debt and WETH collateral (most common)
            const debtAsset = TOKENS.USDC;
            const collateralAsset = TOKENS.WETH;

            // Calculate 50% of total debt to liquidate
            const debtToCover = position.totalDebtBase / 2n;

            console.log("\nAttempting liquidation...");
            console.log("Debt Asset:", debtAsset, "(USDC)");
            console.log("Collateral Asset:", collateralAsset, "(WETH");
            console.log("Debt to Cover:", (Number(debtToCover) / 1e6).toFixed(2), "USDC");

            try {
                // Simulate first
                const canExecute = await executor.simulateLiquidation(
                    position.user,
                    debtAsset,
                    collateralAsset,
                    debtToCover,
                    3000 // 0.3% Uniswap pool
                );

                if (!canExecute) {
                    console.log("⚠️  Simulation failed. Skipping.");
                    continue;
                }

                // Execute
                const tx = await executor.executeLiquidation(
                    position.user,
                    debtAsset,
                    collateralAsset,
                    debtToCover,
                    3000
                );

                console.log("✅ Liquidation successful!");
                console.log("TX:", tx.hash);

                // Wait a bit before next liquidation
                console.log("\nWaiting 10 seconds before next liquidation...");
                await new Promise(resolve => setTimeout(resolve, 10000));

            } catch (error: any) {
                console.error("❌ Liquidation failed:", error.message);
                console.log("Continuing to next position...");
            }
        }

        console.log("\n" + "=".repeat(60));
        console.log("✅ Bot execution complete!");

    } catch (error: any) {
        console.error("\n❌ Bot error:", error.message);
        throw error;
    }
}

// Run the bot
runLiquidationBot()
    .then(() => {
        console.log("\n✅ Bot finished successfully");
        process.exit(0);
    })
    .catch(error => {
        console.error("\n❌ Bot crashed:", error);
        process.exit(1);
    });

import { AaveV3Monitor } from "../services/aave/AaveV3Monitor";
import { AaveV3Executor } from "../services/aave/AaveV3Executor";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Configuration
const ARBITRUM_RPC = process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const FLASH_LIQUIDATOR_ADDRESS = "0x9a55132AA9C800A81f73eB24C9732d52Aa3eced4";

// Test user position
const TEST_USER = "0x00000000d70742d790f9936f25d414dbce6818b0";

// Arbitrum token addresses
const TOKENS = {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548"
};

/**
 * Test liquidation of a specific position
 */
async function testSingleLiquidation() {
    console.log("\n🧪 Testing Single Position Liquidation\n");
    console.log("=".repeat(60));

    // Initialize services
    const monitor = new AaveV3Monitor(ARBITRUM_RPC);
    const executor = new AaveV3Executor(
        FLASH_LIQUIDATOR_ADDRESS,
        PRIVATE_KEY,
        ARBITRUM_RPC
    );

    console.log("Bot Address:", executor.getWalletAddress());
    console.log("FlashLiquidator:", FLASH_LIQUIDATOR_ADDRESS);
    console.log("Target User:", TEST_USER);
    console.log("=".repeat(60));

    try {
        // Step 1: Check position details
        console.log("\n1️⃣ Fetching position details...");
        const accountData = await monitor.getUserAccountData(TEST_USER);

        console.log("\n📊 Position Details:");
        console.log("Health Factor:", ethers.utils.formatEther(accountData.healthFactor));
        console.log("Total Collateral:", ethers.utils.formatUnits(accountData.totalCollateralBase, 8), "USD");
        console.log("Total Debt:", ethers.utils.formatUnits(accountData.totalDebtBase, 8), "USD");
        console.log("Liquidatable:", monitor.isLiquidatable(accountData) ? "✅ YES" : "❌ NO");

        if (!monitor.isLiquidatable(accountData)) {
            console.log("\n⚠️  Position not liquidatable. Exiting.");
            return;
        }

        // Step 2: Calculate liquidation amount
        const maxDebt = monitor.calculateMaxLiquidatableDebt(accountData);
        const { grossProfit, netProfit } = monitor.estimateProfit(maxDebt);

        console.log("\n💰 Liquidation Calculation:");
        console.log("Max Liquidatable Debt:", ethers.utils.formatUnits(maxDebt, 8), "USD");
        console.log("Gross Profit:", ethers.utils.formatEther(grossProfit), "USD");
        console.log("Net Profit:", ethers.utils.formatEther(netProfit), "USD");

        // Step 3: Get user's actual debt and collateral tokens
        console.log("\n2️⃣ Fetching user's actual assets from Aave...");
        
        // Query Aave Pool to get user's reserves data
        const provider = new ethers.providers.JsonRpcProvider(ARBITRUM_RPC);
        const poolABI = [
            "function getUserConfiguration(address user) external view returns (uint256)",
            "function getReservesList() external view returns (address[])"
        ];
        const pool = new ethers.Contract(
            "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Aave V3 Pool
            poolABI,
            provider
        );

        // For simplicity, we'll try common pairs
        // Real implementation should decode getUserConfiguration bitmap
        const commonDebtTokens = [TOKENS.USDC, TOKENS.USDT, TOKENS.DAI];
        const commonCollateralTokens = [TOKENS.WETH, TOKENS.WBTC, TOKENS.ARB];

        console.log("\n3️⃣ Testing liquidation with common token pairs...");
        
        // Try all possible token combinations
        const allTokens = [
            { addr: TOKENS.USDC, symbol: "USDC", decimals: 6, amount: "0.001" },
            { addr: TOKENS.USDT, symbol: "USDT", decimals: 6, amount: "0.001" },
            { addr: TOKENS.DAI, symbol: "DAI", decimals: 18, amount: "0.001" },
            { addr: TOKENS.WETH, symbol: "WETH", decimals: 18, amount: "0.000001" },
            { addr: TOKENS.WBTC, symbol: "WBTC", decimals: 8, amount: "0.00001" },
            { addr: TOKENS.ARB, symbol: "ARB", decimals: 18, amount: "0.001" },
        ];
        
        const tokenPairs = [];
        for (const debt of allTokens) {
            for (const collateral of allTokens) {
                if (debt.addr !== collateral.addr) {
                    tokenPairs.push({
                        debt: debt.addr,
                        debtSymbol: debt.symbol,
                        debtDecimals: debt.decimals,
                        collateral: collateral.addr,
                        collateralSymbol: collateral.symbol,
                        amount: debt.amount
                    });
                }
            }
        }
        
        let liquidationExecuted = false;
        
        for (const pair of tokenPairs) {
            if (liquidationExecuted) break;
            
            console.log(`\n⚙️  Testing ${pair.debtSymbol} debt / ${pair.collateralSymbol} collateral...`);
            
            const debtAsset = pair.debt;
            const collateralAsset = pair.collateral;
            const debtToCover = ethers.utils.parseUnits(pair.amount, pair.debtDecimals);
            
            console.log("\n📋 Liquidation Parameters:");
            console.log(`Debt Asset: ${pair.debtSymbol}`);
            console.log(`Collateral Asset: ${pair.collateralSymbol}`);
            console.log(`Debt to Cover: ${pair.amount} ${pair.debtSymbol}`);
            
            try {

                // Step 4: Simulate liquidation
                console.log("\n4️⃣ Simulating liquidation...");
                
                const canExecute = await executor.simulateLiquidation(
                    TEST_USER,
                    debtAsset,
                    collateralAsset,
                    debtToCover,
                    3000 // 0.3% Uniswap pool
                );

                if (!canExecute) {
                    console.log("❌ Simulation failed - trying next pair...");
                    continue;
                }

                console.log("✅ Simulation passed!");
                console.log(`\n✅ Found correct token pair: ${pair.debtSymbol} debt / ${pair.collateralSymbol} collateral`);

                // Step 5: Execute liquidation
                console.log("\n5️⃣ Executing liquidation...");
                console.log("⚠️  This will cost real gas!");
                
                const tx = await executor.executeLiquidation(
                    TEST_USER,
                    debtAsset,
                    collateralAsset,
                    debtToCover,
                    3000
                );

                console.log("\n✅ LIQUIDATION SUCCESSFUL! 🎉");
                console.log("TX Hash:", tx.hash);
                console.log("View on Arbiscan:", `https://arbiscan.io/tx/${tx.hash}`);

                // Wait for confirmation
                console.log("\nWaiting for confirmation...");
                const receipt = await tx.wait();
                console.log("Confirmed in block:", receipt.blockNumber);
                console.log("Gas used:", receipt.gasUsed.toString());

                // Step 6: Verify position is no longer liquidatable
                console.log("\n6️⃣ Verifying position after liquidation...");
                const updatedAccountData = await monitor.getUserAccountData(TEST_USER);
                
                console.log("\n📊 Updated Position:");
                console.log("Health Factor:", ethers.utils.formatEther(updatedAccountData.healthFactor));
                console.log("Total Collateral:", ethers.utils.formatUnits(updatedAccountData.totalCollateralBase, 8), "USD");
                console.log("Total Debt:", ethers.utils.formatUnits(updatedAccountData.totalDebtBase, 8), "USD");
                console.log("Still Liquidatable:", monitor.isLiquidatable(updatedAccountData) ? "✅ YES" : "❌ NO");

                liquidationExecuted = true;
                console.log("\n✅ End-to-End test complete!");

            } catch (error: any) {
                console.log(`❌ Failed with ${pair.debtSymbol}/${pair.collateralSymbol}:`, error.message);
                console.log("Trying next pair...");
            }
        }
        
        if (!liquidationExecuted) {
            console.log("\n❌ Could not find working token pair.");
            console.log("💡 User may have non-standard tokens. Check Aave UI manually.");
        }

    } catch (error: any) {
        console.error("\n❌ Test error:", error.message);
        throw error;
    }
}

// Run the test
testSingleLiquidation()
    .then(() => {
        console.log("\n✅ Test finished successfully");
        process.exit(0);
    })
    .catch(error => {
        console.error("\n❌ Test failed:", error);
        process.exit(1);
    });

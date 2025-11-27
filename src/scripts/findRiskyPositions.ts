import { ethers } from "ethers";
import { AaveV3Monitor } from "../services/aave/AaveV3Monitor";
import { AaveV3Executor } from "../services/aave/AaveV3Executor";
import dotenv from "dotenv";

dotenv.config();

const ARBITRUM_RPC = process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const FLASH_LIQUIDATOR_ADDRESS = "0x9a55132AA9C800A81f73eB24C9732d52Aa3eced4";

// Standard tokens on Arbitrum Aave V3
const TOKENS = {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDCe: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // Bridged USDC
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
    LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    wstETH: "0x5979D7b546E38E414F7E9822514be443A4800529",
    rETH: "0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8",
    FRAX: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F",
    LUSD: "0x93b346b6BC2548dA6A1E7d98E9a421B42541425b"
};

const TOKEN_NAMES: Record<string, string> = Object.fromEntries(
    Object.entries(TOKENS).map(([k, v]) => [v.toLowerCase(), k])
);

// Aave V3 Pool Data Provider for getting reserve data
const POOL_DATA_PROVIDER = "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654";
const POOL_DATA_PROVIDER_ABI = [
    "function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
    "function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)"
];

interface UserPosition {
    user: string;
    healthFactor: number;
    totalCollateralUSD: number;
    totalDebtUSD: number;
    collateralTokens: { symbol: string; address: string; balance: number }[];
    debtTokens: { symbol: string; address: string; balance: number }[];
}

async function findRiskyPositions() {
    console.log("\n🔍 Searching for Risky Positions with Standard Tokens\n");
    console.log("=".repeat(60));

    const provider = new ethers.providers.JsonRpcProvider(ARBITRUM_RPC);
    const monitor = new AaveV3Monitor(ARBITRUM_RPC);
    const executor = new AaveV3Executor(FLASH_LIQUIDATOR_ADDRESS, PRIVATE_KEY, ARBITRUM_RPC);
    
    const dataProvider = new ethers.Contract(
        POOL_DATA_PROVIDER,
        POOL_DATA_PROVIDER_ABI,
        provider
    );

    // Get users from subgraph with low health factors
    console.log("\n1️⃣ Fetching borrowers from subgraph with HF < 1.5...");
    
    const { AaveV3Subgraph } = await import("../services/aave/AaveV3Subgraph");
    const subgraph = new AaveV3Subgraph();
    const borrowers = await subgraph.getLowHealthFactorUsers();
    
    console.log(`Found ${borrowers.length} borrowers`);

    // Check each position for standard tokens
    console.log("\n2️⃣ Checking positions for standard tokens...\n");
    
    const riskyPositions: UserPosition[] = [];
    const tokenAddresses = Object.values(TOKENS);
    
    let checked = 0;
    for (const borrower of borrowers.slice(0, 500)) { // Check first 500
        checked++;
        if (checked % 50 === 0) {
            console.log(`Checked ${checked}/${Math.min(borrowers.length, 500)} positions...`);
        }
        
        try {
            // Get on-chain health factor
            const accountData = await monitor.getUserAccountData(borrower.address);
            const hf = Number(accountData.healthFactor) / 1e18;
            const collateralUSD = Number(accountData.totalCollateralBase) / 1e8;
            const debtUSD = Number(accountData.totalDebtBase) / 1e8;
            
            // Skip if HF > 1.1 (too healthy) or collateral < $1 (dust)
            if (hf > 1.1 || collateralUSD < 1) {
                continue;
            }
            
            // Check what tokens they have
            const collateralTokens: { symbol: string; address: string; balance: number }[] = [];
            const debtTokens: { symbol: string; address: string; balance: number }[] = [];
            
            for (const tokenAddr of tokenAddresses) {
                try {
                    const reserveData = await dataProvider.getUserReserveData(tokenAddr, borrower.address);
                    
                    const aTokenBalance = Number(reserveData.currentATokenBalance);
                    const variableDebt = Number(reserveData.currentVariableDebt);
                    const stableDebt = Number(reserveData.currentStableDebt);
                    
                    const symbol = TOKEN_NAMES[tokenAddr.toLowerCase()] || tokenAddr.slice(0, 8);
                    
                    if (aTokenBalance > 0 && reserveData.usageAsCollateralEnabled) {
                        collateralTokens.push({ symbol, address: tokenAddr, balance: aTokenBalance });
                    }
                    
                    if (variableDebt > 0 || stableDebt > 0) {
                        debtTokens.push({ symbol, address: tokenAddr, balance: variableDebt + stableDebt });
                    }
                } catch (e) {
                    // Token not supported or error - skip
                }
            }
            
            // Only add if we found standard collateral AND debt tokens
            if (collateralTokens.length > 0 && debtTokens.length > 0) {
                riskyPositions.push({
                    user: borrower.address,
                    healthFactor: hf,
                    totalCollateralUSD: collateralUSD,
                    totalDebtUSD: debtUSD,
                    collateralTokens,
                    debtTokens
                });
                
                console.log(`\n✅ Found risky position!`);
                console.log(`   User: ${borrower.address}`);
                console.log(`   Health Factor: ${hf.toFixed(4)}`);
                console.log(`   Collateral: $${collateralUSD.toFixed(2)}`);
                console.log(`   Debt: $${debtUSD.toFixed(2)}`);
                console.log(`   Collateral Tokens: ${collateralTokens.map(t => t.symbol).join(", ")}`);
                console.log(`   Debt Tokens: ${debtTokens.map(t => t.symbol).join(", ")}`);
                
                // If liquidatable (HF < 1), try to simulate
                if (hf < 1.0) {
                    console.log(`\n   🔥 LIQUIDATABLE! Simulating...`);
                    
                    const debtToken = debtTokens[0];
                    const collateralToken = collateralTokens[0];
                    
                    // Get decimals for proper amount
                    const decimalsMap: Record<string, number> = {
                        "USDC": 6, "USDCe": 6, "USDT": 6,
                        "DAI": 18, "WETH": 18, "ARB": 18, "LINK": 18, 
                        "wstETH": 18, "rETH": 18, "FRAX": 18, "LUSD": 18,
                        "WBTC": 8
                    };
                    
                    const decimals = decimalsMap[debtToken.symbol] || 18;
                    const debtToCover = ethers.utils.parseUnits("0.01", decimals);
                    
                    try {
                        const canExecute = await executor.simulateLiquidation(
                            borrower.address,
                            debtToken.address,
                            collateralToken.address,
                            debtToCover,
                            3000
                        );
                        
                        if (canExecute) {
                            console.log(`   ✅ SIMULATION PASSED! Ready to liquidate!`);
                            console.log(`   Debt: ${debtToken.symbol}, Collateral: ${collateralToken.symbol}`);
                        } else {
                            console.log(`   ❌ Simulation failed - may need different pool fee`);
                        }
                    } catch (e: any) {
                        console.log(`   ❌ Simulation error: ${e.message?.slice(0, 50)}`);
                    }
                }
            }
        } catch (error) {
            // Skip errors
        }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY");
    console.log("=".repeat(60));
    console.log(`Positions checked: ${checked}`);
    console.log(`Risky positions with standard tokens: ${riskyPositions.length}`);
    
    // Sort by health factor (lowest first)
    riskyPositions.sort((a, b) => a.healthFactor - b.healthFactor);
    
    console.log("\n🎯 Top 10 Most Risky Positions:\n");
    
    for (const pos of riskyPositions.slice(0, 10)) {
        const status = pos.healthFactor < 1.0 ? "🔴 LIQUIDATABLE" : "🟡 At Risk";
        console.log(`${status} | HF: ${pos.healthFactor.toFixed(4)} | $${pos.totalDebtUSD.toFixed(2)} debt`);
        console.log(`   User: ${pos.user}`);
        console.log(`   Collateral: ${pos.collateralTokens.map(t => t.symbol).join(", ")}`);
        console.log(`   Debt: ${pos.debtTokens.map(t => t.symbol).join(", ")}`);
        console.log("");
    }

    return riskyPositions;
}

findRiskyPositions()
    .then(positions => {
        console.log(`\n✅ Found ${positions.length} risky positions`);
        process.exit(0);
    })
    .catch(error => {
        console.error("\n❌ Error:", error);
        process.exit(1);
    });

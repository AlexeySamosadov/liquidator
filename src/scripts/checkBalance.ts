import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const ARBITRUM_RPC = process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

async function checkBalance() {
    const provider = new ethers.providers.JsonRpcProvider(ARBITRUM_RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    
    console.log("=".repeat(50));
    console.log("💰 Wallet Balance Check");
    console.log("=".repeat(50));
    console.log("Wallet:", wallet.address);
    
    // ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    const ethValue = Number(ethers.utils.formatEther(ethBalance));
    console.log("\n🔹 ETH Balance:", ethValue.toFixed(6), "ETH");
    console.log("   USD Value:", (ethValue * 3500).toFixed(2), "USD");
    
    // USDC balance
    const usdc = new ethers.Contract(
        "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        ["function balanceOf(address) view returns (uint256)"],
        provider
    );
    const usdcBal = await usdc.balanceOf(wallet.address);
    console.log("\n🔹 USDC Balance:", ethers.utils.formatUnits(usdcBal, 6), "USDC");
    
    // Check contract balance too
    const contractAddress = "0x9a55132AA9C800A81f73eB24C9732d52Aa3eced4";
    const contractEth = await provider.getBalance(contractAddress);
    const contractUsdc = await usdc.balanceOf(contractAddress);
    
    console.log("\n📋 FlashLiquidator Contract:");
    console.log("   Address:", contractAddress);
    console.log("   ETH:", ethers.utils.formatEther(contractEth), "ETH");
    console.log("   USDC:", ethers.utils.formatUnits(contractUsdc, 6), "USDC");
    
    // Gas estimation
    console.log("\n⛽ Gas Estimation for Liquidation:");
    console.log("   Typical gas: ~500,000 units");
    console.log("   Gas price: ~0.01 gwei on Arbitrum");
    console.log("   Cost per liquidation: ~$0.01-0.05");
    console.log("   Your ETH can cover:", Math.floor(ethValue / 0.00001), "liquidations");
    
    console.log("\n" + "=".repeat(50));
    if (ethValue < 0.001) {
        console.log("⚠️  WARNING: Low ETH balance! Need ETH for gas fees.");
        console.log("   Recommend: Bridge at least 0.01 ETH ($35) to Arbitrum");
    } else {
        console.log("✅ You have enough ETH for gas fees!");
    }
    console.log("=".repeat(50));
}

checkBalance().catch(console.error);

import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

async function checkBalance() {
    const ARBITRUM_SEPOLIA_RPC = "https://sepolia-rollup.arbitrum.io/rpc";

    const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

    console.log("\n💰 Balance Check - Arbitrum Sepolia\n");
    console.log("Address:", wallet.address);

    const balance = await provider.getBalance(wallet.address);
    const balanceETH = ethers.formatEther(balance);

    console.log("Balance:", balanceETH, "ETH");

    if (BigInt(balance) > BigInt(0)) {
        console.log("✅ Ready for deployment!");
    } else {
        console.log("⏳ Waiting for funds...");
        console.log("\nGet Sepolia ETH:");
        console.log("1. https://sepoliafaucet.com/");
        console.log("2. Bridge to Arbitrum Sepolia: https://bridge.arbitrum.io/");
    }
}

checkBalance();

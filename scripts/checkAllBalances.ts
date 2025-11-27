import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

async function checkAllBalances() {
    const address = "0x7ae2134584D54ead7764d2377b8483e6d75e0092";
    console.log("\n🔍 Checking balances for:", address);
    console.log("=".repeat(50));

    const networks = [
        { name: "Ethereum Mainnet", rpc: "https://eth.llamarpc.com", symbol: "ETH" },
        { name: "BNB Smart Chain", rpc: "https://bsc-dataseed.binance.org", symbol: "BNB" },
        { name: "Arbitrum One", rpc: "https://arb1.arbitrum.io/rpc", symbol: "ETH" },
        { name: "Arbitrum Sepolia", rpc: "https://sepolia-rollup.arbitrum.io/rpc", symbol: "ETH (Testnet)" },
        { name: "Ethereum Sepolia", rpc: "https://rpc.sepolia.org", symbol: "ETH (Testnet)" }
    ];

    for (const net of networks) {
        try {
            const provider = new ethers.JsonRpcProvider(net.rpc);
            const balance = await provider.getBalance(address);
            const formatted = ethers.formatEther(balance);

            if (balance > 0n) {
                console.log(`✅ ${net.name}: ${formatted} ${net.symbol}`);
            } else {
                console.log(`❌ ${net.name}: 0.00 ${net.symbol}`);
            }
        } catch (e) {
            console.log(`⚠️  ${net.name}: Error connecting`);
        }
    }
    console.log("=".repeat(50));
}

checkAllBalances();

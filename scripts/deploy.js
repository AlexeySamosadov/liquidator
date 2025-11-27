const hre = require("hardhat");

async function main() {
    console.log("\n🚀 Deploying FlashLiquidator to Arbitrum Mainnet...\n");

    const AAVE_V3_POOL_ADDRESSES_PROVIDER = "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb";

    // Get deployer
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying with account:", deployer.address);

    // Get balance
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    // Ethers v5 syntax: utils.formatEther
    console.log("Account balance:", hre.ethers.utils.formatEther(balance), "ETH");

    // Deploy contract
    console.log("\n⏳ Deploying contract...");
    const FlashLiquidator = await hre.ethers.getContractFactory("FlashLiquidator");
    const flashLiquidator = await FlashLiquidator.deploy(AAVE_V3_POOL_ADDRESSES_PROVIDER);

    console.log("Transaction sent! Waiting for confirmation...");

    // Ethers v5 syntax: deployed() instead of waitForDeployment()
    await flashLiquidator.deployed();

    // Ethers v5 syntax: .address property instead of getAddress()
    console.log("\n✅ FlashLiquidator deployed successfully!");
    console.log("📍 Contract Address:", flashLiquidator.address);

    console.log("\n📝 Configuration:");
    console.log("  Pool Addresses Provider:", AAVE_V3_POOL_ADDRESSES_PROVIDER);
    console.log("  Owner:", deployer.address);
    console.log("  Swap Router:", "0xE592427A0AEce92De3Edee1F18E0157C05861564");

    console.log("\n⚠️  SAVE THIS ADDRESS! You will need it for the bot.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

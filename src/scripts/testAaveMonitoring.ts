import { AaveV3Monitor } from '../services/aave/AaveV3Monitor';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test script to monitor Aave V3 positions
 * This is a read-only monitoring script
 */
async function testAaveMonitoring() {
    console.log('🔍 Starting Aave V3 Monitoring Test...\n');

    const RPC_URL = process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc';
    const monitor = new AaveV3Monitor(RPC_URL);

    // Example: Check a specific user (replace with actual address)
    const testUser = '0x0000000000000000000000000000000000000000'; // Replace with real address

    console.log(`Checking user: ${testUser}\n`);

    try {
        const accountData = await monitor.getUserAccountData(testUser);

        console.log('Account Data:');
        console.log('─'.repeat(50));
        console.log(`Total Collateral: $${(Number(accountData.totalCollateralBase) / 1e8).toFixed(2)}`);
        console.log(`Total Debt: $${(Number(accountData.totalDebtBase) / 1e8).toFixed(2)}`);
        console.log(`Health Factor: ${(Number(accountData.healthFactor) / 1e18).toFixed(4)}`);
        console.log(`Liquidatable: ${monitor.isLiquidatable(accountData) ? '✅ YES' : '❌ NO'}`);

        if (monitor.isLiquidatable(accountData)) {
            const maxDebt = monitor.calculateMaxLiquidatableDebt(accountData);
            const { grossProfit, netProfit } = monitor.estimateProfit(maxDebt);

            console.log('\nLiquidation Details:');
            console.log('─'.repeat(50));
            console.log(`Max Liquidatable Debt: $${(Number(maxDebt) / 1e8).toFixed(2)}`);
            console.log(`Gross Profit: $${(Number(grossProfit) / 1e8).toFixed(2)}`);
            console.log(`Net Profit (after fees): $${(Number(netProfit) / 1e8).toFixed(2)}`);
            console.log(`Can liquidate 100%: ${monitor.canLiquidate100Percent(accountData) ? 'YES' : 'NO (50% max)'}`);
        }
    } catch (error: any) {
        console.error('Error:', error.message);
    }

    // TODO: Implement getAllBorrowers() and scan all positions
    console.log('\n📝 Next steps:');
    console.log('   1. Implement getAllBorrowers() using Aave subgraph');
    console.log('   2. Setup continuous monitoring loop');
    console.log('   3. Add WebSocket for real-time updates');
    console.log('   4. Implement flash loan liquidation');
}

// Run if executed directly
if (require.main === module) {
    testAaveMonitoring()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { test AaveMonitoring };

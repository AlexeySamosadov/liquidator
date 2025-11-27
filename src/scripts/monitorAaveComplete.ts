import { AaveV3Subgraph } from '../services/aave/AaveV3Subgraph';
import { AaveV3Monitor } from '../services/aave/AaveV3Monitor';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Complete monitoring script:
 * 1. Gets borrowers from Subgraph
 * 2. Checks their health factors on-chain
 * 3. Finds liquidatable positions
 */
async function monitorAavePositions() {
    console.log('🚀 Starting Aave V3 Complete Monitoring...\n');

    const RPC_URL = process.env.ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc';

    const subgraph = new AaveV3Subgraph();
    const monitor = new AaveV3Monitor(RPC_URL);

    try {
        console.log('Step 1: Fetching borrowers from Subgraph...\n');

        // Get borrowers from subgraph
        const subgraphUsers = await subgraph.getLowHealthFactorUsers();

        if (subgraphUsers.length === 0) {
            console.log('✅ No borrowers found');
            return;
        }

        console.log(`\nStep 2: On-chain verification for ${subgraphUsers.length} users...\n`);

        // Check each user on-chain
        const liquidatablePositions = await monitor.findLiquidatablePositions(
            subgraphUsers.map(u => u.address),
            BigInt(50e18) // Min $50 profit
        );

        if (liquidatablePositions.length === 0) {
            console.log('ℹ️  No profitable liquidations found');
            return;
        }

        console.log(`\n🎯 FOUND ${liquidatablePositions.length} LIQUIDATABLE POSITIONS!\n`);
        console.log('═'.repeat(80));

        liquidatablePositions.forEach((position, i) => {
            console.log(`\n${i + 1}. User: ${position.user}`);
            console.log(`   HF: ${(Number(position.healthFactor) / 1e18).toFixed(6)}`);
            console.log(`   Debt: $${(Number(position.totalDebtBase) / 1e8).toFixed(2)}`);
            console.log(`   💰 Profit: $${(Number(position.estimatedProfit) / 1e18).toFixed(2)}`);
        });

        console.log('\n' + '═'.repeat(80));
        const totalProfit = liquidatablePositions.reduce((sum, p) => sum + Number(p.estimatedProfit), 0) / 1e18;
        console.log(`\n💵 Total potential profit: $${totalProfit.toFixed(2)}`);

    } catch (error: any) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

if (require.main === module) {
    monitorAavePositions()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { monitorAavePositions };

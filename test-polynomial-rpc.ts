import { ethers } from 'ethers';

async function testPolynomialRPC() {
    console.log('🔍 Testing Polynomial Chain RPC access...\n');

    // Public RPC - NO API KEY NEEDED!
    const RPC_URL = 'https://rpc.polynomial.fi';
    const PERPS_MARKET = '0xD052Fa8b2af8Ed81C764D5d81cCf2725B2148688';

    try {
        // 1. Connect to RPC
        console.log('1️⃣ Connecting to RPC:', RPC_URL);
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        // 2. Get network info
        const network = await provider.getNetwork();
        console.log('✅ Connected to network:');
        console.log('   Chain ID:', network.chainId.toString());
        console.log('   Name:', network.name);

        // 3. Get latest block
        const blockNumber = await provider.getBlockNumber();
        console.log('\n2️⃣ Latest block:', blockNumber);

        const block = await provider.getBlock(blockNumber);
        console.log('   Timestamp:', new Date(block!.timestamp * 1000).toISOString());
        console.log('   Transactions:', block!.transactions.length);

        // 4. Get last 10 blocks to check activity
        console.log('\n3️⃣ Last 10 blocks activity:');
        let totalTxs = 0;
        for (let i = 0; i < 10; i++) {
            const b = await provider.getBlock(blockNumber - i);
            totalTxs += b!.transactions.length;
            console.log(`   Block ${blockNumber - i}: ${b!.transactions.length} txs`);
        }
        console.log(`   Total txs in last 10 blocks: ${totalTxs}`);
        console.log(`   Average: ${(totalTxs / 10).toFixed(1)} txs/block`);

        // 5. Check Perps Market contract
        console.log('\n4️⃣ Perps Market Contract:', PERPS_MARKET);
        const code = await provider.getCode(PERPS_MARKET);
        console.log('   Contract exists:', code !== '0x');
        console.log('   Code size:', code.length, 'bytes');

        // 6. Try to get contract storage (basic check)
        const storage = await provider.getStorage(PERPS_MARKET, 0);
        console.log('   Storage accessible:', storage !== null);

        console.log('\n✅ SUCCESS! RPC is fully accessible WITHOUT API key!');
        console.log('\n📝 Summary:');
        console.log('   - RPC connection: ✅ Working');
        console.log('   - Read blockchain data: ✅ Working');
        console.log('   - Contract access: ✅ Working');
        console.log('   - API key needed: ❌ NO!');

    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        if (error.code === 'NETWORK_ERROR') {
            console.log('\n⚠️ Network error - RPC might be down or restricted');
        }
    }
}

testPolynomialRPC();

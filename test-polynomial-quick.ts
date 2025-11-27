import { ethers } from 'ethers';

async function quickTest() {
    const RPC_URL = 'https://rpc.polynomial.fi';

    try {
        console.log('Testing RPC:', RPC_URL);
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        const blockNumber = await provider.getBlockNumber();
        console.log('✅ Block number:', blockNumber);
        console.log('✅ RPC works! NO API KEY NEEDED!');

    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }
}

quickTest();

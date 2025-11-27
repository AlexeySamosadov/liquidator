import { ethers } from 'ethers';
import { GMX_READER_ABI } from '../contracts/abis/GMXReader.abi';

const RPC_URL = 'https://arb1.arbitrum.io/rpc';
const READER_ADDRESS = '0x1EC018d2b6ACCA20a0bEDb86450b7E27D1D8355B';
const DATASTORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';

async function testReader() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const reader = new ethers.Contract(READER_ADDRESS, GMX_READER_ABI, provider);

    console.log('Testing getMarkets...');
    try {
        const markets = await reader.getMarkets(DATASTORE_ADDRESS, 0, 10);
        console.log(`Success! Found ${markets.length} markets.`);
    } catch (error) {
        console.error('getMarkets failed:', error);
    }
}

testReader().catch(console.error);

/**
 * Debug GMX Reader getMarket function
 */

import { ethers } from 'ethers';
import { GMX_ARBITRUM_ADDRESSES } from '../config/chains';
import { GMX_READER_ABI } from '../contracts/abis/GMXReader.abi';

async function main() {
    console.log('================================================================================');
    console.log('Debugging GMX Reader getMarket');
    console.log('================================================================================');

    const rpcUrl = 'https://arb1.arbitrum.io/rpc';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const readerAddress = GMX_ARBITRUM_ADDRESSES.reader;
    const dataStoreAddress = GMX_ARBITRUM_ADDRESSES.dataStore;

    // 0x09400D9DB990D5ed3f35D7be61DfAEB900Af03C9 (Failed in bot)
    const marketAddress = '0x09400D9DB990D5ed3f35D7be61DfAEB900Af03C9';

    console.log('Reader:', readerAddress);
    console.log('DataStore:', dataStoreAddress);
    console.log('Market:', marketAddress);

    if (!readerAddress || !dataStoreAddress) {
        console.error('Missing addresses');
        return;
    }

    const reader = new ethers.Contract(readerAddress, GMX_READER_ABI, provider);

    try {
        console.log('Calling getMarket(dataStore, market)...');
        const market = await reader.getMarket(dataStoreAddress, marketAddress);
        console.log('Success!');
        console.log('Market Token:', market.marketToken);
        console.log('Index Token:', market.indexToken);
        console.log('Long Token:', market.longToken);
        console.log('Short Token:', market.shortToken);
    } catch (error) {
        console.error('Error calling getMarket:', error);
    }
}

main().catch(console.error);

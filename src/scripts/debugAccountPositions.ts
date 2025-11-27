import { ethers } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMXAddresses } from '../types';
import * as dotenv from 'dotenv';

dotenv.config();

const TARGET_ACCOUNT = '0x16Fd4F9Bc62258231b12e0bcB0f07dBa9CC6bE58';

const GMX_ARBITRUM_ADDRESSES: GMXAddresses = {
    reader: '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E',
    dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    exchangeRouter: '0x7C68C7866A64FA2160F78EEaE1209B9F3A8d79ab',
    marketFactory: '0x0000000000000000000000000000000000000000',
    depositVault: '0x0000000000000000000000000000000000000000'
};

async function debugAccountPositions() {
    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);

    console.log(`🔍 Checking DataStore for account: ${TARGET_ACCOUNT}`);

    try {
        const positionKeys = await gmxContracts.getAccountPositionKeys(TARGET_ACCOUNT);
        console.log(`\nFound ${positionKeys.length} positions in DataStore index.`);

        if (positionKeys.length > 0) {
            console.log('Position Keys:', positionKeys);

            // If keys exist, let's try to read size for the first one
            const ds = gmxContracts.getDataStore();
            const firstKey = positionKeys[0];

            const sizeInUsdKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_SIZE_IN_USD'), ethers.getBytes(firstKey)]));
            const sizeInUsd = await ds.getUint(sizeInUsdKey);

            console.log(`\nFirst Position Size (USD): ${ethers.formatUnits(sizeInUsd, 30)}`);
        } else {
            console.log('❌ Account has NO open positions in GMX V2.');
        }

    } catch (error) {
        console.error('Failed to get account position keys:', error);
    }
}

debugAccountPositions().catch(console.error);

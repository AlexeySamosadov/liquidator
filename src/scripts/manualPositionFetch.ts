import { ethers } from 'ethers';
import { GMX_DATASTORE_ABI } from '../contracts/abis/GMXDataStore.abi';
import { GMX_READER_ABI } from '../contracts/abis/GMXReader.abi';

const RPC_URL = 'https://arb1.arbitrum.io/rpc';
const READER_ADDRESS = '0x1EC018d2b6ACCA20a0bEDb86450b7E27D1D8355B';
const DATASTORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';
const TEST_ACCOUNT = '0xe4d31c2541A9cE596419879B1A46Ffc7cD202c62'; // One of the accounts from debug log

async function manualFetch() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const dataStore = new ethers.Contract(DATASTORE_ADDRESS, GMX_DATASTORE_ABI, provider);
    const reader = new ethers.Contract(READER_ADDRESS, GMX_READER_ABI, provider);

    console.log('1. Calculating keys...');
    const ACCOUNT_POSITION_LIST = ethers.keccak256(ethers.toUtf8Bytes("ACCOUNT_POSITION_LIST"));
    const accountKey = ethers.solidityPackedKeccak256(
        ['bytes32', 'address'],
        [ACCOUNT_POSITION_LIST, TEST_ACCOUNT]
    );
    console.log(`Account Key: ${accountKey}`);

    console.log('2. Fetching position count...');
    try {
        // getBytes32Count(bytes32 key)
        const count = await dataStore.getBytes32Count(accountKey);
        console.log(`Count: ${count}`);

        if (count > 0n) {
            console.log('3. Fetching position keys...');
            // getBytes32ValuesAt(bytes32 key, uint256 start, uint256 end)
            // Note: ABI might need update if getBytes32ValuesAt is missing
            const keys = await dataStore.getBytes32ValuesAt(accountKey, 0n, count);
            console.log(`Keys:`, keys);

            console.log('4. Fetching position info...');
            for (const key of keys) {
                try {
                    const position = await reader.getPosition(DATASTORE_ADDRESS, key);
                    console.log('Position:', position);
                } catch (e) {
                    console.error(`Failed to get position ${key}:`, e);
                }
            }
        }
    } catch (error) {
        console.error('Fetch failed:', error);
    }
}

manualFetch().catch(console.error);

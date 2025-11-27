import { ethers } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMXAddresses } from '../types';
import * as dotenv from 'dotenv';

dotenv.config();

const GMX_ARBITRUM_ADDRESSES: GMXAddresses = {
    reader: '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E',
    dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    exchangeRouter: '0x7C68C7866A64FA2160F78EEaE1209B9F3A8d79ab',
    marketFactory: '0x0000000000000000000000000000000000000000',
    depositVault: '0x0000000000000000000000000000000000000000'
};

async function debugDataStoreKeys() {
    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);
    const ds = gmxContracts.getDataStore();

    console.log('🔍 Debugging DataStore Keys...');

    // Test 1: Raw "marketList" bytes (Current implementation)
    // 'marketList' in hex
    const rawMarketList = '0x6d61726b65744c69737400000000000000000000000000000000000000000000';
    try {
        const count = await ds.getAddressCount(rawMarketList);
        console.log(`1. Raw "marketList" bytes: ${count}`);
    } catch (e: any) {
        console.log(`1. Raw "marketList" bytes: ERROR (${e.message})`);
    }

    // Test 2: keccak256("MARKET_LIST")
    const hashMarketListCaps = ethers.keccak256(ethers.toUtf8Bytes('MARKET_LIST'));
    try {
        const count = await ds.getAddressCount(hashMarketListCaps);
        console.log(`2. keccak256("MARKET_LIST"): ${count}`);
    } catch (e: any) {
        console.log(`2. keccak256("MARKET_LIST"): ERROR (${e.message})`);
    }

    // Test 3: keccak256("marketList")
    const hashMarketListLower = ethers.keccak256(ethers.toUtf8Bytes('marketList'));
    try {
        const count = await ds.getAddressCount(hashMarketListLower);
        console.log(`3. keccak256("marketList"): ${count}`);
    } catch (e: any) {
        console.log(`3. keccak256("marketList"): ERROR (${e.message})`);
    }

    // Test 4: keccak256(abi.encode("MARKET_LIST"))
    const hashMarketListEncoded = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['MARKET_LIST']));
    try {
        const count = await ds.getAddressCount(hashMarketListEncoded);
        console.log(`4. keccak256(abi.encode("MARKET_LIST")): ${count}`);
    } catch (e: any) {
        console.log(`4. keccak256(abi.encode("MARKET_LIST")): ERROR (${e.message})`);
    }

    // Test 5: keccak256(abi.encodePacked("MARKET_LIST"))
    const hashMarketListPacked = ethers.solidityPackedKeccak256(['string'], ['MARKET_LIST']);
    try {
        const count = await ds.getAddressCount(hashMarketListPacked);
        console.log(`5. keccak256(abi.encodePacked("MARKET_LIST")): ${count}`);
    } catch (e: any) {
        console.log(`5. keccak256(abi.encodePacked("MARKET_LIST")): ERROR (${e.message})`);
    }

    // Test 6: keccak256(abi.encodePacked("marketList"))
    const hashMarketListPackedLower = ethers.solidityPackedKeccak256(['string'], ['marketList']);
    try {
        const count = await ds.getAddressCount(hashMarketListPackedLower);
        console.log(`6. keccak256(abi.encodePacked("marketList")): ${count}`);
    } catch (e: any) {
        console.log(`6. keccak256(abi.encodePacked("marketList")): ERROR (${e.message})`);
    }

    // Test 7: POSITION_LIST check
    // const hashPositionList = ethers.keccak256(ethers.toUtf8Bytes('POSITION_LIST')); 
    const hashPositionListCorrect = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['POSITION_LIST']));
    try {
        const count = await ds.getBytes32Count(hashPositionListCorrect);
        console.log(`7. keccak256(abi.encode("POSITION_LIST")): ${count}`);
    } catch (e) {
        console.log(`7. keccak256(abi.encode("POSITION_LIST")): ERROR`);
    }

    // Test 8: Account Position List
    const account = '0xd4D546D6Cd679360E48CDa736178C5Fa627D93e5';
    const accountPositionListKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['ACCOUNT_POSITION_LIST']));

    // Key = keccak256(abi.encode(accountPositionListKey, account))
    const accountListKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'address'], [accountPositionListKey, account]));

    try {
        const count = await ds.getBytes32Count(accountListKey);
        console.log(`8. Account Position Count (Standard Hash): ${count}`);

        if (count > 0n) {
            const positionKeys = await ds.getBytes32ValuesAt(accountListKey, 0n, 1n);
            const actualKey = positionKeys[0];
            console.log(`   Actual Position Key from DataStore: ${actualKey}`);

            // Test 9: Position Size Key (moved here for comparison)
            // const account = '0xd4D546D6Cd679360E48CDa736178C5Fa627D93e5'; // Already defined
            const market = '0x7f1fa204bb700853D36994DA19F830b6Ad18455C';
            const collateralToken = '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4';
            const isLong = true;

            // Try both position key formats
            const posKeyEncoded = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'address', 'bool'],
                [account, market, collateralToken, isLong]
            ));
            const posKeyPacked = ethers.solidityPackedKeccak256(
                ['address', 'address', 'address', 'bool'],
                [account, market, collateralToken, isLong]
            );

            if (actualKey === posKeyEncoded) {
                console.log('   ✅ MATCHES ENCODED KEY (abi.encode)');
            } else if (actualKey === posKeyPacked) {
                console.log('   ✅ MATCHES PACKED KEY (abi.encodePacked)');
            } else {
                console.log('   ❌ MATCHES NEITHER');
            }

            // Try to read size using the ACTUAL key
            const positionSizeKeyHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['POSITION_SIZE_IN_USD']));

            // Try standard nested key: keccak256(abi.encode(propertyKey, positionKey))
            const sizeKeyStandard = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [positionSizeKeyHash, actualKey]));
            try {
                const size = await ds.getUint(sizeKeyStandard);
                console.log(`   Size (Standard Nested Key): ${size}`);
            } catch (e) { }
        }

    } catch (e: any) {
        console.log(`8. Account Position Count: ERROR (${e.message})`);
    }

    // Test 9: Position Size Key (Original location, now partially redundant but kept for structure)
    // const account = '0xd4D546D6Cd679360E48CDa736178C5Fa627D93e5'; // Redefined for clarity in this block - REMOVED
    const market = '0x7f1fa204bb700853D36994DA19F830b6Ad18455C';
    const collateralToken = '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4';
    const isLong = true;

    // Try both position key formats
    const posKeyEncoded = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'address', 'bool'],
        [account, market, collateralToken, isLong]
    ));
    const posKeyPacked = ethers.solidityPackedKeccak256(
        ['address', 'address', 'address', 'bool'],
        [account, market, collateralToken, isLong]
    );

    console.log(`Position Key (Encoded): ${posKeyEncoded}`);
    console.log(`Position Key (Packed): ${posKeyPacked}`);

    const positionSizeKeyHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['POSITION_SIZE_IN_USD']));

    // Try reading size with Encoded Key
    const sizeKey1 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [positionSizeKeyHash, posKeyEncoded]));
    try {
        const size = await ds.getUint(sizeKey1);
        console.log(`9. Size (Encoded Key): ${size}`);
    } catch (e) { }

    // Try reading size with Packed Key
    const sizeKey2 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [positionSizeKeyHash, posKeyPacked]));
    try {
        const size = await ds.getUint(sizeKey2);
        console.log(`10. Size (Packed Key): ${size}`);
    } catch (e) { }
}

debugDataStoreKeys().catch(console.error);

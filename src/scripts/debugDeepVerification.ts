import { ethers } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMXAddresses } from '../types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const GMX_ARBITRUM_ADDRESSES: GMXAddresses = {
    reader: '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E',
    dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    exchangeRouter: '0x7C68C7866A64FA2160F78EEaE1209B9F3A8d79ab',
    marketFactory: '0x0000000000000000000000000000000000000000',
    depositVault: '0x0000000000000000000000000000000000000000'
};

async function debugDeepVerification() {
    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);
    const ds = gmxContracts.getDataStore();

    // Load all positions
    const targetsPath = path.join(__dirname, '../../data/gmx_verified_positions.json');
    const allTargets = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));

    // Filter for "solid" positions: Leverage < 5x
    const solidTargets = allTargets.filter((t: any) => t.leverage < 5 && t.leverage > 1);

    console.log(`Found ${solidTargets.length} solid positions (Lev < 5x). Checking first 10...`);

    const sample = solidTargets.slice(0, 10);

    for (const target of sample) {
        console.log(`\n--- Checking ${target.account} ---`);
        console.log(`Market: ${target.market}`);
        console.log(`Collateral: ${target.collateralToken}`);
        console.log(`IsLong: ${target.isLong}`);
        console.log(`Expected Size: $${target.sizeUsd}`);

        // 1. Verify Checksums
        const account = ethers.getAddress(target.account);
        const market = ethers.getAddress(target.market);
        const collateralToken = ethers.getAddress(target.collateralToken);

        if (account !== target.account) console.warn('⚠️ Account checksum mismatch!');
        if (market !== target.market) console.warn('⚠️ Market checksum mismatch!');
        if (collateralToken !== target.collateralToken) console.warn('⚠️ Collateral checksum mismatch!');

        // 2. Generate Key Manually
        const positionKey = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'address', 'bool'],
                [account, market, collateralToken, target.isLong]
            )
        );
        console.log(`Generated Key: ${positionKey}`);

        // 3. Read Size
        const sizeInUsdKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_SIZE_IN_USD'), ethers.getBytes(positionKey)]));
        const sizeInUsd = await ds.getUint(sizeInUsdKey);

        console.log(`Actual Size (USD): ${ethers.formatUnits(sizeInUsd, 30)}`);

        if (sizeInUsd > 0n) {
            console.log('✅ POSITION FOUND!');
        } else {
            console.log('❌ Position Closed/Missing');
        }
    }
}

debugDeepVerification().catch(console.error);

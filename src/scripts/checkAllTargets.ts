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

async function checkAllTargets() {
    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);
    const ds = gmxContracts.getDataStore();

    // Load targets
    const targetsPath = path.join(__dirname, '../../data/gmx_small_liquidation_targets.json');
    const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));

    console.log(`🔍 Checking status of ${targets.length} targets...`);
    console.log('='.repeat(80));
    console.log(`| ${'Account'.padEnd(10)} | ${'Market'.padEnd(10)} | ${'Size ($)'.padEnd(10)} | ${'Coll ($)'.padEnd(10)} | ${'Health'.padEnd(10)} | ${'Status'.padEnd(10)} |`);
    console.log('-'.repeat(80));

    let activeCount = 0;
    let closedCount = 0;
    let liquidatableCount = 0;

    for (const target of targets) {
        const positionKey = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'address', 'bool'],
                [target.account, target.market, target.collateralToken, target.isLong]
            )
        );

        const sizeInUsdKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_SIZE_IN_USD'), ethers.getBytes(positionKey)]));
        const collateralAmountKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_COLLATERAL_AMOUNT'), ethers.getBytes(positionKey)]));

        try {
            const sizeInUsd = await ds.getUint(sizeInUsdKey);
            const collateralAmount = await ds.getUint(collateralAmountKey);

            if (sizeInUsd === 0n) {
                closedCount++;
                // console.log(`| ${target.account.slice(0, 10)} | ${target.market.slice(0, 10)} | ${'0'.padEnd(10)} | ${'0'.padEnd(10)} | ${'-'.padEnd(10)} | 🔴 CLOSED  |`);
                continue; // Skip closed positions to reduce noise, or log them? Let's skip for cleaner output
            }

            activeCount++;
            const sizeUsd = Number(ethers.formatUnits(sizeInUsd, 30));
            const collateralUsd = Number(ethers.formatUnits(collateralAmount, 6)); // Assume USDC for simplicity in display

            // Rough Health Calc
            const liquidationThreshold = 0.01; // 1%
            const health = collateralUsd / (sizeUsd * liquidationThreshold);

            let status = '✅ OK';
            if (health < 1.0) {
                status = '🚨 LIQ!';
                liquidatableCount++;
            } else if (health < 1.5) {
                status = '⚠️ RISK';
            }

            console.log(`| ${target.account.slice(0, 10)} | ${target.market.slice(0, 10)} | ${sizeUsd.toFixed(0).padEnd(10)} | ${collateralUsd.toFixed(2).padEnd(10)} | ${health.toFixed(2).padEnd(10)} | ${status.padEnd(10)} |`);

        } catch (error) {
            console.error(`Error checking ${target.account}:`, error);
        }
    }

    console.log('='.repeat(80));
    console.log(`Summary:`);
    console.log(`Total Targets: ${targets.length}`);
    console.log(`Active: ${activeCount}`);
    console.log(`Closed/Liquidated: ${closedCount}`);
    console.log(`Currently Liquidatable: ${liquidatableCount}`);
}

checkAllTargets().catch(console.error);

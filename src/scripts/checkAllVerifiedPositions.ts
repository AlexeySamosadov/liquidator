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
    exchangeRouter: '0x7c68c7866a64fa2160f78eeae12217ffbf871fa8',
    marketFactory: '0x0000000000000000000000000000000000000000',
    depositVault: '0x0000000000000000000000000000000000000000'
};

async function checkAllVerifiedPositions() {
    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);
    // const ds = gmxContracts.getDataStore();

    // Load targets
    const targetsPath = path.join(__dirname, '../../data/gmx_verified_positions.json');
    const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));

    console.log(`🔍 Checking status of ALL ${targets.length} verified positions...`);
    console.log('This may take a minute...');

    let activeCount = 0;
    let closedCount = 0;
    const activePositions = [];

    // Batch processing
    const BATCH_SIZE = 20; // Reduce batch size for RPC calls

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (target: any) => {
            try {
                // Correct Key Format: keccak256(abi.encode(...))
                const positionKey = ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ['address', 'address', 'address', 'bool'],
                        [target.account, target.market, target.collateralToken, target.isLong]
                    )
                );

                // Use Reader contract to get full position info
                // getPosition returns a tuple: (position, fees, ...)
                // We only need position.sizeInUsd which is at index 0 (position struct) -> index 3 (sizeInUsd)
                // Actually Reader.getPosition returns a single struct Position.

                const result = await gmxContracts.getReader().getPosition(gmxContracts.getDataStoreAddress(), positionKey);

                // Result structure based on ABI:
                // It returns a single tuple which is the Position struct.

                const position = result; // The result IS the position struct
                const sizeInUsd = position.sizeInUsd;

                if (sizeInUsd > 0n) {
                    return {
                        ...target,
                        currentSizeUsd: ethers.formatUnits(sizeInUsd, 30),
                        collateralAmount: ethers.formatUnits(position.collateralAmount, 18) // Assuming 18 decimals for now
                    };
                }
                return null;
            } catch (e) {
                // If position doesn't exist, Reader might revert or return empty.
                // Usually it returns empty struct if not found, but let's handle errors.
                return null;
            }
        });

        const results = await Promise.all(promises);
        const active = results.filter(r => r !== null);

        activeCount += active.length;
        closedCount += (batch.length - active.length);
        activePositions.push(...active);

        process.stdout.write(`\rChecked ${Math.min(i + BATCH_SIZE, targets.length)}/${targets.length} | Active: ${activeCount} | Closed: ${closedCount}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log(`Summary:`);
    console.log(`Total Checked: ${targets.length}`);
    console.log(`Active: ${activeCount}`);
    console.log(`Closed: ${closedCount}`);

    if (activeCount > 0) {
        const outPath = path.join(__dirname, '../../data/gmx_live_positions.json');
        fs.writeFileSync(outPath, JSON.stringify(activePositions, null, 2));
        console.log(`\n✅ Saved ${activeCount} LIVE positions to ${outPath}`);
    } else {
        console.log('\n❌ No active positions found in the entire dataset.');
    }
}

checkAllVerifiedPositions().catch(console.error);

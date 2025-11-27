/**
 * Random Account Position Checker
 * Check on-chain positions for RANDOM accounts (not just whales)
 */

import { logger } from '../utils/logger';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

interface Position {
    id: string;
    account: string;
    market: string;
    collateralToken: string;
    isLong: boolean;
    sizeInUsd: string;
    sizeInTokens: string;
    collateralAmount: string;
}

const READER_ABI = [
    'function getAccountPositions(address dataStore, address account, uint256 start, uint256 end) view returns (tuple(address account, address market, address collateralToken, uint256 sizeInUsd, uint256 sizeInTokens, uint256 collateralAmount, uint256 borrowingFactor, uint256 fundingFeeAmountPerSize, uint256 longTokenClaimableFundingAmountPerSize, uint256 shortTokenClaimableFundingAmountPerSize, uint256 increasedAtBlock, uint256 decreasedAtBlock, bool isLong)[])'
];

const READER_ADDRESS = '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E';
const DATASTORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';

async function checkRandomAccounts() {
    logger.info('================================================================================');
    logger.info('GMX V2 Random Account Position Checker');
    logger.info('================================================================================');

    try {
        const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const reader = new ethers.Contract(READER_ADDRESS, READER_ABI, provider);

        // Load GraphQL data
        const dataFile = path.join(__dirname, '../../data/gmx_all_positions.json');
        const allPositions: Position[] = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

        // Get UNIQUE accounts
        const uniqueAccounts = [...new Set(allPositions.map(p => p.account))];
        logger.info(`\nTotal unique accounts in GraphQL: ${uniqueAccounts.length.toLocaleString()}`);

        // Select 200 RANDOM accounts
        const randomAccounts: string[] = [];
        const indices = new Set<number>();

        while (indices.size < 200 && indices.size < uniqueAccounts.length) {
            const randomIndex = Math.floor(Math.random() * uniqueAccounts.length);
            indices.add(randomIndex);
        }

        indices.forEach(i => randomAccounts.push(uniqueAccounts[i]));

        logger.info(`\n🔍 CHECKING 200 RANDOM ACCOUNTS ON-CHAIN:\n`);
        logger.info('═══════════════════════════════════════════════════════════════');

        let totalAccountsChecked = 0;
        let accountsWithOpenPositions = 0;
        let totalOpenPositions = 0;

        const sizeCategories = {
            tiny: 0,    // < $100
            small: 0,   // $100-$1k
            medium: 0,  // $1k-$100k
            large: 0,   // $100k-$1M
            whale: 0    // > $1M
        };

        for (let i = 0; i < randomAccounts.length; i++) {
            const account = randomAccounts[i];
            totalAccountsChecked++;

            logger.info(`\n${i + 1}. Account: ${account}`);

            try {
                // Get on-chain positions for this account
                const onChainPositions = await reader.getAccountPositions(
                    DATASTORE_ADDRESS,
                    account,
                    0,
                    10
                );

                const realPositions = onChainPositions.filter((p: any) => parseFloat(ethers.formatUnits(p.sizeInTokens, 18)) > 0);

                if (realPositions.length > 0) {
                    accountsWithOpenPositions++;
                    logger.info(`   ✅ Found ${realPositions.length} REAL open position(s):`);

                    for (const pos of realPositions) {
                        totalOpenPositions++;
                        const sizeUsd = parseFloat(ethers.formatUnits(pos.sizeInUsd, 30));
                        const collateral = parseFloat(ethers.formatUnits(pos.collateralAmount, 18));
                        const leverage = collateral > 0 ? sizeUsd / collateral : 0;

                        logger.info(`      - Size: $${sizeUsd.toFixed(2)}, Collateral: ${collateral.toFixed(4)}, Leverage: ${leverage.toFixed(2)}x, ${pos.isLong ? 'LONG' : 'SHORT'}`);

                        // Categorize by size
                        if (sizeUsd < 100) sizeCategories.tiny++;
                        else if (sizeUsd < 1000) sizeCategories.small++;
                        else if (sizeUsd < 100000) sizeCategories.medium++;
                        else if (sizeUsd < 1000000) sizeCategories.large++;
                        else sizeCategories.whale++;
                    }
                } else {
                    logger.info(`   ❌ No open positions`);
                }

            } catch (error: any) {
                logger.error(`   ⚠️  Error checking account: ${error.message}`);
            }

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        logger.info('\n═══════════════════════════════════════════════════════════════');
        logger.info('\n📊 RESULTS FROM RANDOM SAMPLE:');
        logger.info(`   Accounts Checked:           ${totalAccountsChecked}`);
        logger.info(`   Accounts with Open Pos:     ${accountsWithOpenPositions}`);
        logger.info(`   Total Real Open Positions:  ${totalOpenPositions}`);
        logger.info('');
        logger.info('📊 SIZE DISTRIBUTION OF REAL POSITIONS:');
        logger.info(`   Tiny   (< $100):       ${sizeCategories.tiny}`);
        logger.info(`   Small  ($100-$1k):     ${sizeCategories.small}`);
        logger.info(`   Medium ($1k-$100k):    ${sizeCategories.medium}`);
        logger.info(`   Large  ($100k-$1M):    ${sizeCategories.large}`);
        logger.info(`   Whale  (> $1M):        ${sizeCategories.whale}`);
        logger.info('');

        const extrapolated = Math.round((totalOpenPositions / totalAccountsChecked) * uniqueAccounts.length);
        logger.info(`💡 EXTRAPOLATION:`);
        logger.info(`   If we check ALL ${uniqueAccounts.length.toLocaleString()} unique accounts,`);
        logger.info(`   we might find approximately ${extrapolated.toLocaleString()} real open positions!`);
        logger.info('═══════════════════════════════════════════════════════════════');

    } catch (error) {
        logger.error('Check failed:', error);
        throw error;
    }
}

// Run
checkRandomAccounts()
    .then(() => {
        logger.info('\n✅ Check complete!');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Failed:', error);
        process.exit(1);
    });

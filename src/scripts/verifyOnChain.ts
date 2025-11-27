/**
 * On-Chain Position Verifier
 * Check if GraphQL positions are ACTUALLY open on-chain
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
    'function getPosition(address dataStore, bytes32 key) view returns (tuple(address account, address market, address collateralToken, uint256 sizeInUsd, uint256 sizeInTokens, uint256 collateralAmount, uint256 borrowingFactor, uint256 fundingFeeAmountPerSize, uint256 longTokenClaimableFundingAmountPerSize, uint256 shortTokenClaimableFundingAmountPerSize, uint256 increasedAtBlock, uint256 decreasedAtBlock, bool isLong))'
];

const READER_ADDRESS = '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E';
const DATASTORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';

async function verifyOnChain() {
    logger.info('================================================================================');
    logger.info('GMX V2 On-Chain Position Verifier');
    logger.info('================================================================================');

    try {
        const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const reader = new ethers.Contract(READER_ADDRESS, READER_ABI, provider);

        // Load GraphQL data
        const dataFile = path.join(__dirname, '../../data/gmx_all_positions.json');
        const allPositions: Position[] = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

        // Filter for shrimp positions with zero collateral
        const suspiciousPositions = allPositions.filter(p => {
            const sizeUsd = parseFloat(p.sizeInUsd) / 1e30;
            const collateral = parseFloat(p.collateralAmount);
            return sizeUsd >= 100 && sizeUsd < 1000 && collateral === 0;
        });

        logger.info(`\nFound ${suspiciousPositions.length.toLocaleString()} suspicious shrimp positions (zero collateral)`);

        // Check first 5 on-chain
        const samplesToCheck = suspiciousPositions.slice(0, 5);

        logger.info('\n🔍 CHECKING ON-CHAIN STATUS:\n');
        logger.info('═══════════════════════════════════════════════════════════════');

        let reallyOpen = 0;
        let reallyClosed = 0;

        for (let i = 0; i < samplesToCheck.length; i++) {
            const pos = samplesToCheck[i];

            logger.info(`\n${i + 1}. Checking position...`);
            logger.info(`   GraphQL ID:  ${pos.id}`);
            logger.info(`   Account:     ${pos.account}`);
            logger.info(`   Market:      ${pos.market}`);
            logger.info(`   GraphQL Size: $${(parseFloat(pos.sizeInUsd) / 1e30).toFixed(2)}`);

            try {
                // Generate position key
                const positionKey = ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ['address', 'address', 'address', 'bool'],
                        [pos.account, pos.market, pos.collateralToken, pos.isLong]
                    )
                );

                // Get on-chain position
                const onChainPosition = await reader.getPosition(DATASTORE_ADDRESS, positionKey);

                const onChainSize = parseFloat(ethers.formatUnits(onChainPosition.sizeInUsd, 30));
                const onChainCollateral = parseFloat(ethers.formatUnits(onChainPosition.collateralAmount, 18));
                const onChainSizeTokens = parseFloat(ethers.formatUnits(onChainPosition.sizeInTokens, 18));

                const isActuallyOpen = onChainSizeTokens > 0;

                logger.info(`   ---`);
                logger.info(`   On-Chain Size:       $${onChainSize.toFixed(2)}`);
                logger.info(`   On-Chain Collateral: ${onChainCollateral.toFixed(6)} tokens`);
                logger.info(`   On-Chain Tokens:     ${onChainSizeTokens.toFixed(6)}`);
                logger.info(`   ACTUAL STATUS:       ${isActuallyOpen ? '✅ REALLY OPEN' : '❌ REALLY CLOSED'}`);

                if (isActuallyOpen) {
                    reallyOpen++;
                } else {
                    reallyClosed++;
                }

            } catch (error: any) {
                logger.error(`   ❌ On-chain check failed: ${error.message}`);
            }

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        logger.info('\n═══════════════════════════════════════════════════════════════');
        logger.info('\n📊 VERIFICATION RESULTS:');
        logger.info(`   GraphQL says "Open":  ${samplesToCheck.length}/5`);
        logger.info(`   Actually Open:        ${reallyOpen}/5`);
        logger.info(`   Actually Closed:      ${reallyClosed}/5`);
        logger.info(`   Accuracy:             ${((reallyOpen / samplesToCheck.length) * 100).toFixed(1)}%`);

    } catch (error) {
        logger.error('Verification failed:', error);
        throw error;
    }
}

// Run
verifyOnChain()
    .then(() => {
        logger.info('\n✅ Verification complete!');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Failed:', error);
        process.exit(1);
    });

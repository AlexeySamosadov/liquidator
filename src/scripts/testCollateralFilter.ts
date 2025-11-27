/**
 * Test Collateral Filter
 * Verify if filtering by collateralAmount > 0 returns valid open positions
 */

import { logger } from '../utils/logger';
import { ethers } from 'ethers';
import fetch from 'node-fetch';

const READER_ABI = [
    'function getPosition(address dataStore, bytes32 key) view returns (tuple(address account, address market, address collateralToken, uint256 sizeInUsd, uint256 sizeInTokens, uint256 collateralAmount, uint256 borrowingFactor, uint256 fundingFeeAmountPerSize, uint256 longTokenClaimableFundingAmountPerSize, uint256 shortTokenClaimableFundingAmountPerSize, uint256 increasedAtBlock, uint256 decreasedAtBlock, bool isLong))'
];

const READER_ADDRESS = '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E';
const DATASTORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';

async function testCollateralFilter() {
    logger.info('================================================================================');
    logger.info('Testing GraphQL Filter: collateralAmount_gt: "0" AND sizeInUsd_gt: "$10"');
    logger.info('================================================================================');

    const query = `
    query GetPositionsWithCollateral {
      positions(
        where: { 
          collateralAmount_gt: "0" 
          sizeInUsd_gt: "10000000000000000000000000000000"
        }
        limit: 20
        orderBy: sizeInUsd_ASC
      ) {
        id
        account
        market
        collateralToken
        isLong
        sizeInUsd
        sizeInTokens
        collateralAmount
      }
    }
  `;

    try {
        // 1. Fetch from GraphQL
        logger.info('Fetching positions with collateral > 0 AND size > $10...');
        const response = await fetch('https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });

        const result: any = await response.json();
        const positions = result.data?.positions || [];

        logger.info(`Found ${positions.length} positions`);

        if (positions.length === 0) {
            logger.warn('No positions found with this filter!');
            return;
        }

        // 2. Verify On-Chain
        const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const reader = new ethers.Contract(READER_ADDRESS, READER_ABI, provider);

        logger.info('\n🔍 Verifying On-Chain:');

        let validCount = 0;

        for (const pos of positions) {
            const positionKey = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ['address', 'address', 'address', 'bool'],
                    [pos.account, pos.market, pos.collateralToken, pos.isLong]
                )
            );

            try {
                const onChainPos = await reader.getPosition(DATASTORE_ADDRESS, positionKey);
                const onChainCollateral = parseFloat(ethers.formatUnits(onChainPos.collateralAmount, 18));
                const onChainSize = parseFloat(ethers.formatUnits(onChainPos.sizeInTokens, 18));
                const graphQLCollateral = pos.collateralAmount;
                const graphQLSizeUsd = parseFloat(pos.sizeInUsd) / 1e30;

                const hasCollateral = onChainPos.collateralAmount > 0n;
                const hasSize = onChainPos.sizeInTokens > 0n;
                const isValid = hasCollateral && hasSize;

                if (isValid) validCount++;

                logger.info(`   Account: ${pos.account.slice(0, 8)}...`);
                logger.info(`   GraphQL Size:             $${graphQLSizeUsd.toFixed(2)}`);
                logger.info(`   GraphQL Collateral (Raw): ${graphQLCollateral}`);
                logger.info(`   On-Chain Collateral:      ${onChainCollateral.toFixed(6)}`);
                logger.info(`   On-Chain Size:            ${onChainSize.toFixed(6)}`);
                logger.info(`   Status: ${isValid ? '✅ TRULY OPEN' : '❌ CLOSED/DUST'}`);
                logger.info('   ---');

                await new Promise(r => setTimeout(r, 200));
            } catch (e: any) {
                logger.error(`   Error checking: ${e.message}`);
            }
        }

        logger.info(`\nResult: ${validCount}/${positions.length} positions are valid.`);

    } catch (error) {
        logger.error('Test failed:', error);
    }
}

testCollateralFilter();

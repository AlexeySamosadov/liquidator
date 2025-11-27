/**
 * Full On-Chain Account Scanner
 * Efficiently scans ALL unique accounts using Multicall to find real positions
 */

import { logger } from '../utils/logger';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// GMX V2 Contracts
const READER_ADDRESS = '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E';
const DATASTORE_ADDRESS = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';
const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'; // Multicall3 on Arbitrum

// ABIs
// Corrected ABI with extra timestamp field before isLong
const READER_ABI = [
    'function getAccountPositions(address dataStore, address account, uint256 start, uint256 end) view returns (tuple(address account, address market, address collateralToken, uint256 sizeInUsd, uint256 sizeInTokens, uint256 collateralAmount, uint256 borrowingFactor, uint256 fundingFeeAmountPerSize, uint256 longTokenClaimableFundingAmountPerSize, uint256 shortTokenClaimableFundingAmountPerSize, uint256 increasedAtBlock, uint256 decreasedAtBlock, uint256 updatedAtTime, bool isLong)[])'
];

const MULTICALL_ABI = [
    'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

// Token Decimals Mapping
const TOKEN_DECIMALS: { [key: string]: number } = {
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 6, // USDC
    '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8': 6, // USDC.e
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': 6, // USDT
    '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': 8, // WBTC
};

function getDecimals(token: string): number {
    return TOKEN_DECIMALS[token] || 18;
}

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

interface VerifiedPosition {
    account: string;
    market: string;
    collateralToken: string;
    isLong: boolean;
    sizeInUsd: string;
    sizeInTokens: string;
    collateralAmount: string;
    leverage: string;
    borrowingFactor: string;
    fundingFeePerSize: string;
    longTokenClaimable: string;
    shortTokenClaimable: string;
    increasedAtBlock: string;
    decreasedAtBlock: string;
    updatedAtTime: string;
}

async function scanAllAccounts() {
    logger.info('================================================================================');
    logger.info('GMX V2 Full Account Scanner (Multicall) - FIXED');
    logger.info('================================================================================');

    try {
        const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
        const provider = new ethers.JsonRpcProvider(rpcUrl);

        // Initialize contracts
        const readerInterface = new ethers.Interface(READER_ABI);
        const multicall = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, provider);

        // 1. Load Accounts
        logger.info('Loading accounts from JSON...');
        const dataFile = path.join(__dirname, '../../data/gmx_all_positions.json');
        const allPositions: Position[] = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

        const uniqueAccounts = [...new Set(allPositions.map(p => p.account))];
        logger.info(`Found ${uniqueAccounts.length.toLocaleString()} unique accounts to scan`);

        // 2. Scan in Batches
        const BATCH_SIZE = 50; // Accounts per multicall
        const verifiedPositions: VerifiedPosition[] = [];
        let processedCount = 0;

        logger.info(`Starting scan with batch size ${BATCH_SIZE}...`);
        const startTime = Date.now();

        for (let i = 0; i < uniqueAccounts.length; i += BATCH_SIZE) {
            const batchAccounts = uniqueAccounts.slice(i, i + BATCH_SIZE);

            // Prepare calls
            const calls = batchAccounts.map(account => ({
                target: READER_ADDRESS,
                callData: readerInterface.encodeFunctionData('getAccountPositions', [
                    DATASTORE_ADDRESS,
                    account,
                    0,
                    10 // Check first 10 positions per account
                ])
            }));

            try {
                // Execute Multicall
                const results: any[] = await multicall.tryAggregate.staticCall(false, calls);

                // Process Results
                results.forEach((result) => {
                    if (result.success) {
                        try {
                            const decoded = readerInterface.decodeFunctionResult('getAccountPositions', result.returnData);
                            const positions = decoded[0]; // Array of positions

                            for (const pos of positions) {
                                const sizeInTokens = parseFloat(ethers.formatUnits(pos.sizeInTokens, 18));

                                if (sizeInTokens > 0) {
                                    // SizeInUsd is ALWAYS 30 decimals in GMX V2
                                    const sizeUsd = parseFloat(ethers.formatUnits(pos.sizeInUsd, 30));

                                    // Filter dust
                                    if (sizeUsd < 10) continue;

                                    // Collateral is in native token decimals
                                    const decimals = getDecimals(pos.collateralToken);
                                    const collateral = parseFloat(ethers.formatUnits(pos.collateralAmount, decimals));

                                    const leverage = collateral > 0 ? sizeUsd / collateral : 0;

                                    verifiedPositions.push({
                                        account: pos.account,
                                        market: pos.market,
                                        collateralToken: pos.collateralToken,
                                        isLong: pos.isLong,
                                        sizeInUsd: sizeUsd.toFixed(2),
                                        sizeInTokens: sizeInTokens.toFixed(6),
                                        collateralAmount: collateral.toFixed(6),
                                        leverage: leverage.toFixed(2),
                                        borrowingFactor: pos.borrowingFactor.toString(),
                                        fundingFeePerSize: pos.fundingFeeAmountPerSize.toString(),
                                        longTokenClaimable: pos.longTokenClaimableFundingAmountPerSize.toString(),
                                        shortTokenClaimable: pos.shortTokenClaimableFundingAmountPerSize.toString(),
                                        increasedAtBlock: pos.increasedAtBlock.toString(),
                                        decreasedAtBlock: pos.decreasedAtBlock.toString(),
                                        updatedAtTime: pos.updatedAtTime.toString()
                                    });
                                }
                            }
                        } catch (e) {
                            // Decoding error (ignore)
                        }
                    }
                });

            } catch (error: any) {
                logger.error(`Batch failed: ${error.message}`);
            }

            processedCount += batchAccounts.length;

            // Log progress every 1000 accounts
            if (processedCount % 1000 === 0 || processedCount === uniqueAccounts.length) {
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = processedCount / elapsed;
                const eta = (uniqueAccounts.length - processedCount) / rate;

                logger.info(`Progress: ${processedCount.toLocaleString()}/${uniqueAccounts.length.toLocaleString()} accounts | Found: ${verifiedPositions.length} positions | Rate: ${rate.toFixed(0)} acc/s | ETA: ${eta.toFixed(0)}s`);
            }

            // Rate limit slightly to avoid RPC bans
            await new Promise(r => setTimeout(r, 50));
        }

        logger.info('\n✅ Scan Complete!');
        logger.info(`Total Verified Positions: ${verifiedPositions.length.toLocaleString()}`);

        // 3. Save Verified Data
        const outFile = path.join(__dirname, '../../data/gmx_verified_positions.json');
        fs.writeFileSync(outFile, JSON.stringify(verifiedPositions, null, 2));
        logger.info(`💾 Saved verified positions to: ${outFile}`);

        // 4. Final Analysis
        logger.info('\n📊 VERIFIED POSITION ANALYSIS:');

        let tiny = 0, small = 0, medium = 0, large = 0, whale = 0;

        for (const p of verifiedPositions) {
            const size = parseFloat(p.sizeInUsd);
            if (size < 100) tiny++;
            else if (size < 1000) small++;
            else if (size < 100000) medium++;
            else if (size < 1000000) large++;
            else whale++;
        }

        logger.info(`   Tiny   (< $100):       ${tiny.toLocaleString()} (${(tiny / verifiedPositions.length * 100).toFixed(1)}%)`);
        logger.info(`   Small  ($100-$1k):     ${small.toLocaleString()} (${(small / verifiedPositions.length * 100).toFixed(1)}%)`);
        logger.info(`   Medium ($1k-$100k):    ${medium.toLocaleString()} (${(medium / verifiedPositions.length * 100).toFixed(1)}%)`);
        logger.info(`   Large  ($100k-$1M):    ${large.toLocaleString()} (${(large / verifiedPositions.length * 100).toFixed(1)}%)`);
        logger.info(`   Whale  (> $1M):        ${whale.toLocaleString()} (${(whale / verifiedPositions.length * 100).toFixed(1)}%)`);

    } catch (error) {
        logger.error('Scan failed:', error);
        throw error;
    }
}

scanAllAccounts();

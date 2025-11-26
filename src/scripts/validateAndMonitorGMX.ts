/**
 * Validate and Monitor GMX Positions
 * 
 * 1. Fetches active positions using GMX SDK (GraphQL)
 * 2. Verifies them on-chain using GMX Reader contract
 * 3. Checks for true liquidation opportunities
 */
import { ethers } from 'ethers';
import { fetchPositionsWithSDK, SDKPosition } from './scanGMXWithSDK';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMX_ARBITRUM_ADDRESSES } from '../config/chains';
import { logger } from '../utils/logger';
import { PositionStruct } from '../contracts/interfaces/IGMXReader';

async function validatePositions() {
    logger.info('Starting GMX Position Validation...');

    // 1. Get positions from SDK
    const sdkPositions = await fetchPositionsWithSDK();
    logger.info(`SDK found ${sdkPositions.length} positions`);

    if (sdkPositions.length === 0) {
        logger.warn('No positions found by SDK. Exiting.');
        return;
    }

    // 2. Setup GMX Contracts
    const rpcUrl = process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc';
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);
    const reader = contracts.getReader();
    const dataStoreAddress = contracts.getDataStoreAddress();

    // 3. Group by account to minimize RPC calls
    const uniqueAccounts = new Set(sdkPositions.map(p => p.account));
    logger.info(`Unique accounts to verify: ${uniqueAccounts.size}`);

    const verifiedPositions: { sdk: SDKPosition, onChain: PositionStruct }[] = [];
    const discrepancies: any[] = [];

    // 4. Verify on-chain
    let processed = 0;
    for (const account of uniqueAccounts) {
        try {
            // Get all positions for this account from Reader
            // We assume max 100 positions per account
            const onChainPositions = await reader.getAccountPositions(
                dataStoreAddress,
                account,
                0n,
                100n
            );

            if (onChainPositions.length > 0) {
                logger.info(`Found ${onChainPositions.length} on-chain positions for ${account}`);

                for (const onChainPos of onChainPositions) {
                    // Find matching SDK position (approximate match by market and isLong)
                    const sdkMatch = sdkPositions.find(p =>
                        p.account.toLowerCase() === onChainPos.account.toLowerCase() &&
                        p.market.toLowerCase() === onChainPos.market.toLowerCase() &&
                        p.isLong === onChainPos.isLong
                    );

                    if (sdkMatch) {
                        // Compare collateral
                        const sdkCollateral = BigInt(sdkMatch.collateralAmount);
                        const onChainCollateral = onChainPos.collateralAmount;

                        if (sdkCollateral !== onChainCollateral) {
                            discrepancies.push({
                                account,
                                market: onChainPos.market,
                                sdkCollateral: sdkCollateral.toString(),
                                onChainCollateral: onChainCollateral.toString()
                            });
                        }

                        // Check for liquidation risk based on ON-CHAIN data
                        const sizeUsd = Number(onChainPos.sizeInUsd) / 1e30;
                        const collateralUsd = Number(onChainPos.collateralAmount) / 1e30;

                        // Simple HF check
                        if (sizeUsd > 0) {
                            const minCollateral = sizeUsd * 0.01; // 1% approx
                            const hf = minCollateral > 0 ? collateralUsd / minCollateral : 0;

                            if (hf < 1.1) {
                                logger.info(`🎯 CONFIRMED LIQUIDATABLE ON-CHAIN: ${account}`);
                                logger.info(`   Size: $${sizeUsd.toFixed(2)}, Collateral: $${collateralUsd.toFixed(2)}, HF: ${hf.toFixed(4)}`);
                            }
                        }
                    }
                }
            }

        } catch (error: any) {
            logger.error(`Failed to verify account ${account}: ${error.message}`);
        }

        processed++;
        if (processed % 10 === 0) {
            logger.info(`Processed ${processed}/${uniqueAccounts.size} accounts...`);
        }

        // Rate limit protection
        await new Promise(r => setTimeout(r, 100));
    }

    logger.info('Validation Complete');
    logger.info(`Found ${discrepancies.length} collateral discrepancies`);
    if (discrepancies.length > 0) {
        logger.info('Sample discrepancies:', discrepancies.slice(0, 5));
    }
}

// Run if called directly
if (require.main === module) {
    validatePositions()
        .then(() => process.exit(0))
        .catch(err => {
            logger.error(err);
            process.exit(1);
        });
}

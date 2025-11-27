/**
 * Detailed Position Inspector
 * Examine specific "shrimp" positions in detail
 */

import { logger } from '../utils/logger';
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

async function inspectShrimpPositions() {
    logger.info('================================================================================');
    logger.info('GMX V2 Position Inspector - Detailed Analysis of "Shrimp" Positions');
    logger.info('================================================================================');

    try {
        // Load data
        const dataFile = path.join(__dirname, '../../data/gmx_all_positions.json');
        const allPositions: Position[] = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

        logger.info(`\nLoaded ${allPositions.length.toLocaleString()} positions from file`);

        // Filter for "shrimp" positions ($100 - $1,000)
        const shrimpPositions = allPositions.filter(p => {
            const sizeUsd = parseFloat(p.sizeInUsd) / 1e30;
            return sizeUsd >= 100 && sizeUsd < 1000;
        });

        logger.info(`Found ${shrimpPositions.length.toLocaleString()} shrimp positions ($100-$1k)`);

        // Randomly select 10
        const randomShrimpPositions: Position[] = [];
        const indices = new Set<number>();

        while (indices.size < 10 && indices.size < shrimpPositions.length) {
            const randomIndex = Math.floor(Math.random() * shrimpPositions.length);
            indices.add(randomIndex);
        }

        indices.forEach(i => randomShrimpPositions.push(shrimpPositions[i]));

        logger.info('\n📊 DETAILED INSPECTION OF 10 RANDOM SHRIMP POSITIONS:\n');
        logger.info('═══════════════════════════════════════════════════════════════');

        for (let i = 0; i < randomShrimpPositions.length; i++) {
            const pos = randomShrimpPositions[i];

            const sizeUsd = parseFloat(pos.sizeInUsd) / 1e30;
            const sizeTokens = parseFloat(pos.sizeInTokens) / 1e18;
            const collateral = parseFloat(pos.collateralAmount) / 1e18;

            logger.info(`\n${i + 1}. Position Details:`);
            logger.info(`   ID:              ${pos.id}`);
            logger.info(`   Account:         ${pos.account}`);
            logger.info(`   Market:          ${pos.market}`);
            logger.info(`   Collateral Token: ${pos.collateralToken}`);
            logger.info(`   Direction:       ${pos.isLong ? 'LONG' : 'SHORT'}`);
            logger.info(`   ---`);
            logger.info(`   Position Size:    $${sizeUsd.toFixed(2)} USD`);
            logger.info(`   Size in Tokens:   ${sizeTokens.toFixed(6)}`);
            logger.info(`   Collateral:       ${collateral.toFixed(6)} tokens`);
            logger.info(`   ---`);

            // Check if truly open
            const isOpen = parseFloat(pos.sizeInTokens) > 0;
            logger.info(`   Status:          ${isOpen ? '✅ OPEN' : '❌ CLOSED'}`);

            // Calculate rough leverage
            if (collateral > 0 && sizeUsd > 0) {
                const leverage = sizeUsd / (collateral * sizeUsd / sizeTokens);
                logger.info(`   Est. Leverage:    ${leverage.toFixed(2)}x`);
            }
        }

        logger.info('\n═══════════════════════════════════════════════════════════════');
        logger.info('\n💡 Summary:');

        const openCount = randomShrimpPositions.filter(p => parseFloat(p.sizeInTokens) > 0).length;
        const closedCount = randomShrimpPositions.length - openCount;

        logger.info(`   Open:    ${openCount}/10`);
        logger.info(`   Closed:  ${closedCount}/10`);

    } catch (error) {
        logger.error('Failed to inspect positions:', error);
        throw error;
    }
}

// Run
inspectShrimpPositions()
    .then(() => {
        logger.info('\n✅ Inspection complete!');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Failed:', error);
        process.exit(1);
    });

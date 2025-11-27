/**
 * GMX V2 Historical Data Collection & Analysis
 * Collect ALL positions and analyze size distribution
 */

import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function collectAndAnalyzePositions() {
    logger.info('================================================================================');
    logger.info('GMX V2 Historical Data Collection');
    logger.info('================================================================================');

    try {
        // Collect ALL positions (no filters - gets everything including closed/historical)
        logger.info('\n📊 Collecting ALL positions (including historical)...');

        let allPositions: any[] = [];
        let offset = 0;
        const batchSize = 1000;
        let hasMore = true;

        while (hasMore && allPositions.length < 500000) {
            const query = `
        query GetAllPositions($offset: Int!, $limit: Int!) {
          positions(
            offset: $offset
            limit: $limit
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

            const response = await fetch('https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query,
                    variables: { offset, limit: batchSize },
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result: any = await response.json();
            const data = result.data;

            if (data && data.positions && data.positions.length > 0) {
                allPositions.push(...data.positions);

                if (allPositions.length % 10000 === 0 || allPositions.length >= 500000) {
                    logger.info(`Progress: ${allPositions.length.toLocaleString()} positions collected`);
                }

                if (data.positions.length < batchSize || allPositions.length >= 500000) {
                    hasMore = false;
                } else {
                    offset += batchSize;
                }

                await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
            } else {
                hasMore = false;
            }
        }

        logger.info(`\n✅ Collected ${allPositions.length} total positions`);

        // Save to JSON file
        const dataDir = path.join(__dirname, '../../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const dataFile = path.join(dataDir, 'gmx_all_positions.json');
        fs.writeFileSync(dataFile, JSON.stringify(allPositions, null, 2));
        logger.info(`💾 Saved to: ${dataFile}`);

        // Analyze size distribution
        logger.info('\n📈 ANALYZING POSITION SIZE DISTRIBUTION\n');
        logger.info('═══════════════════════════════════════════════════════════════');

        const openPositions = allPositions.filter(p => parseFloat(p.sizeInTokens) > 0);
        const closedPositions = allPositions.filter(p => parseFloat(p.sizeInTokens) === 0);

        logger.info(`Total Positions (All Time):     ${allPositions.length.toLocaleString()}`);
        logger.info(`Open Positions:                  ${openPositions.length.toLocaleString()}`);
        logger.info(`Closed Positions:                ${closedPositions.length.toLocaleString()}`);
        logger.info('═══════════════════════════════════════════════════════════════');

        // Analyze by size (for all positions)
        const categorize = (positions: any[]) => {
            const tiny = [];      // < $100
            const small = [];     // $100 - $1k
            const medium = [];    // $1k - $100k
            const large = [];     // $100k - $1M
            const whale = [];     // > $1M

            for (const pos of positions) {
                const sizeUsd = parseFloat(pos.sizeInUsd) / 1e30;

                if (sizeUsd < 100) tiny.push(pos);
                else if (sizeUsd < 1000) small.push(pos);
                else if (sizeUsd < 100000) medium.push(pos);
                else if (sizeUsd < 1000000) large.push(pos);
                else whale.push(pos);
            }

            return { tiny, small, medium, large, whale };
        };

        const allCategorized = categorize(allPositions);
        const openCategorized = categorize(openPositions);

        logger.info('\n📊 ALL POSITIONS (Historical):');
        logger.info(`  Tiny   (< $100):          ${allCategorized.tiny.length.toLocaleString()}`);
        logger.info(`  Small  ($100 - $1k):      ${allCategorized.small.length.toLocaleString()}`);
        logger.info(`  Medium ($1k - $100k):     ${allCategorized.medium.length.toLocaleString()}`);
        logger.info(`  Large  ($100k - $1M):     ${allCategorized.large.length.toLocaleString()}`);
        logger.info(`  Whale  (> $1M):           ${allCategorized.whale.length.toLocaleString()}`);

        logger.info('\n📊 CURRENTLY OPEN POSITIONS:');
        logger.info(`  Tiny   (< $100):          ${openCategorized.tiny.length.toLocaleString()}`);
        logger.info(`  Small  ($100 - $1k):      ${openCategorized.small.length.toLocaleString()}`);
        logger.info(`  Medium ($1k - $100k):     ${openCategorized.medium.length.toLocaleString()}`);
        logger.info(`  Large  ($100k - $1M):     ${openCategorized.large.length.toLocaleString()}`);
        logger.info(`  Whale  (> $1M):           ${openCategorized.whale.length.toLocaleString()}`);

        logger.info('\n📊 CLOSED POSITIONS (Potentially Liquidated):');
        const closedCategorized = categorize(closedPositions);
        logger.info(`  Tiny   (< $100):          ${closedCategorized.tiny.length.toLocaleString()}`);
        logger.info(`  Small  ($100 - $1k):      ${closedCategorized.small.length.toLocaleString()}`);
        logger.info(`  Medium ($1k - $100k):     ${closedCategorized.medium.length.toLocaleString()}`);
        logger.info(`  Large  ($100k - $1M):     ${closedCategorized.large.length.toLocaleString()}`);
        logger.info(`  Whale  (> $1M):           ${closedCategorized.whale.length.toLocaleString()}`);

        const closureRate = (closedPositions.length / allPositions.length * 100).toFixed(2);
        logger.info(`\nClosure Rate: ${closureRate}% of all positions have been closed`);

        logger.info('═══════════════════════════════════════════════════════════════');

    } catch (error) {
        logger.error('Failed to collect/analyze data:', error);
        throw error;
    }
}

// Run
collectAndAnalyzePositions()
    .then(() => {
        logger.info('\n✅ Collection and analysis complete!');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Failed:', error);
        process.exit(1);
    });

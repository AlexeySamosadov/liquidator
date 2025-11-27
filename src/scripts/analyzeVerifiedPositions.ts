/**
 * Detailed Analysis of Verified GMX Positions
 * Analyzes leverage, direction, markets, and specific cohorts (e.g. shrimps)
 */

import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

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
}

async function analyzeVerifiedPositions() {
    logger.info('================================================================================');
    logger.info('GMX V2 Verified Positions Analysis');
    logger.info('================================================================================');

    try {
        const dataFile = path.join(__dirname, '../../data/gmx_verified_positions.json');
        if (!fs.existsSync(dataFile)) {
            throw new Error('Verified positions file not found. Run "npm run gmx:scan-all" first.');
        }

        const positions: VerifiedPosition[] = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
        logger.info(`Loaded ${positions.length.toLocaleString()} verified positions.\n`);

        // --- 1. Direction Analysis ---
        let longs = 0;
        let shorts = 0;
        let longVol = 0;
        let shortVol = 0;

        for (const p of positions) {
            const size = parseFloat(p.sizeInUsd);
            if (p.isLong) {
                longs++;
                longVol += size;
            } else {
                shorts++;
                shortVol += size;
            }
        }

        logger.info('📊 DIRECTION (Long vs Short):');
        logger.info(`   Longs:  ${longs.toLocaleString()} (${(longs / positions.length * 100).toFixed(1)}%) | Volume: $${(longVol / 1e6).toFixed(2)}M`);
        logger.info(`   Shorts: ${shorts.toLocaleString()} (${(shorts / positions.length * 100).toFixed(1)}%) | Volume: $${(shortVol / 1e6).toFixed(2)}M`);
        logger.info(`   Ratio (L/S): ${(longs / shorts).toFixed(2)} (Count) | ${(longVol / shortVol).toFixed(2)} (Volume)`);
        logger.info('   ---------------------------------------------------------------');

        // --- 2. Leverage Analysis ---
        const leverages = positions.map(p => parseFloat(p.leverage)).sort((a, b) => a - b);
        const avgLev = leverages.reduce((a, b) => a + b, 0) / leverages.length;
        const medianLev = leverages[Math.floor(leverages.length / 2)];
        const maxLev = leverages[leverages.length - 1];

        let lev1to5 = 0, lev5to10 = 0, lev10to20 = 0, lev20to50 = 0, lev50plus = 0;
        for (const l of leverages) {
            if (l <= 5) lev1to5++;
            else if (l <= 10) lev5to10++;
            else if (l <= 20) lev10to20++;
            else if (l <= 50) lev20to50++;
            else lev50plus++;
        }

        logger.info('\n⚖️  LEVERAGE DISTRIBUTION:');
        logger.info(`   Average: ${avgLev.toFixed(2)}x`);
        logger.info(`   Median:  ${medianLev.toFixed(2)}x`);
        logger.info(`   Max:     ${maxLev.toFixed(2)}x`);
        logger.info('');
        logger.info(`   1x - 5x:    ${lev1to5.toLocaleString()} (${(lev1to5 / positions.length * 100).toFixed(1)}%)`);
        logger.info(`   5x - 10x:   ${lev5to10.toLocaleString()} (${(lev5to10 / positions.length * 100).toFixed(1)}%)`);
        logger.info(`   10x - 20x:  ${lev10to20.toLocaleString()} (${(lev10to20 / positions.length * 100).toFixed(1)}%)`);
        logger.info(`   20x - 50x:  ${lev20to50.toLocaleString()} (${(lev20to50 / positions.length * 100).toFixed(1)}%)`);
        logger.info(`   > 50x:      ${lev50plus.toLocaleString()} (${(lev50plus / positions.length * 100).toFixed(1)}%)`);
        logger.info('   ---------------------------------------------------------------');

        // --- 3. Market Analysis ---
        const markets: { [key: string]: { count: number, volume: number } } = {};

        // Known market mapping (simplified for common ones, usually need on-chain lookup)
        // For now we use the address
        for (const p of positions) {
            if (!markets[p.market]) markets[p.market] = { count: 0, volume: 0 };
            markets[p.market].count++;
            markets[p.market].volume += parseFloat(p.sizeInUsd);
        }

        const sortedMarkets = Object.entries(markets).sort((a, b) => b[1].volume - a[1].volume).slice(0, 5);

        logger.info('\n🏆 TOP 5 MARKETS (by Volume):');
        sortedMarkets.forEach(([market, data], index) => {
            logger.info(`   ${index + 1}. ${market.slice(0, 10)}...`);
            logger.info(`      Volume: $${(data.volume / 1e6).toFixed(2)}M | Positions: ${data.count}`);
        });
        logger.info('   ---------------------------------------------------------------');

        // --- 4. "Shrimp" Analysis (< $1000) ---
        const shrimps = positions.filter(p => parseFloat(p.sizeInUsd) < 1000);
        const shrimpLevs = shrimps.map(p => parseFloat(p.leverage));
        const shrimpAvgLev = shrimpLevs.reduce((a, b) => a + b, 0) / (shrimpLevs.length || 1);

        let shrimpLongs = 0;
        shrimps.forEach(p => { if (p.isLong) shrimpLongs++ });

        logger.info('\n🦐 SHRIMP COHORT (< $1,000):');
        logger.info(`   Count:          ${shrimps.length.toLocaleString()} (${(shrimps.length / positions.length * 100).toFixed(1)}% of total)`);
        logger.info(`   Avg Leverage:   ${shrimpAvgLev.toFixed(2)}x`);
        logger.info(`   Direction:      ${shrimpLongs} Longs (${(shrimpLongs / shrimps.length * 100).toFixed(1)}%) / ${shrimps.length - shrimpLongs} Shorts`);

        // High leverage shrimps
        const degenShrimps = shrimps.filter(p => parseFloat(p.leverage) > 50);
        logger.info(`   Degens (>50x):  ${degenShrimps.length} positions`);
        logger.info('   ---------------------------------------------------------------');

    } catch (error) {
        logger.error('Analysis failed:', error);
    }
}

analyzeVerifiedPositions();

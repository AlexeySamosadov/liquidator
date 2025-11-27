/**
 * Filter small high-risk positions suitable for liquidation with limited capital
 * Focus on "shrimp" liquidations: high leverage (>20x) + small size (<$1000)
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

interface VerifiedPosition {
    account: string;
    market: string;
    collateralToken: string;
    isLong: boolean;
    sizeInUsd: string;
    sizeInTokens: string;
    collateralAmount: string;
    leverage: string;
}

async function main() {
    logger.info('='.repeat(80));
    logger.info('Filtering Small High-Risk Liquidation Targets');
    logger.info('='.repeat(80));

    // Load verified positions
    const dataFile = path.join(__dirname, '../../data/gmx_verified_positions.json');
    const positions: VerifiedPosition[] = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

    logger.info(`Total positions: ${positions.length}`);

    // Parse and filter positions
    const positionsWithData = positions.map(pos => {
        const leverage = Number(pos.leverage);
        const sizeUsd = Number(pos.sizeInUsd);
        const collateralUsd = sizeUsd / leverage;

        return {
            ...pos,
            leverage,
            sizeUsd,
            collateralUsd
        };
    }).filter(p => {
        // Remove dust positions with near-zero collateral
        return p.collateralUsd >= 1; // At least $1 collateral
    });

    logger.info(`After removing dust: ${positionsWithData.length} positions`);

    // Define criteria for small liquidations
    const maxSize = 1000; // Max $1000 position size
    const minLeverage = 20; // At least 20x leverage (easier to liquidate)
    const maxCollateral = 100; // Max $100 collateral (affordable for small bot)

    const smallTargets = positionsWithData.filter(p =>
        p.sizeUsd <= maxSize &&
        p.leverage >= minLeverage &&
        p.collateralUsd <= maxCollateral &&
        p.collateralUsd >= 10 // At least $10 to make it worth the gas
    );

    // Further segment by size
    const tiny = smallTargets.filter(p => p.sizeUsd < 100); // <$100
    const small = smallTargets.filter(p => p.sizeUsd >= 100 && p.sizeUsd < 500); // $100-500
    const medium = smallTargets.filter(p => p.sizeUsd >= 500 && p.sizeUsd <= 1000); // $500-1000

    logger.info('\n📊 Small Liquidation Targets Distribution:');
    logger.info(`  Tiny (<$100): ${tiny.length} positions`);
    logger.info(`  Small ($100-500): ${small.length} positions`);
    logger.info(`  Medium ($500-1k): ${medium.length} positions`);
    logger.info(`  TOTAL: ${smallTargets.length} positions`);

    // Analyze leverage distribution
    const ultraHigh = smallTargets.filter(p => p.leverage >= 50);
    const high = smallTargets.filter(p => p.leverage >= 30 && p.leverage < 50);
    const moderate = smallTargets.filter(p => p.leverage >= 20 && p.leverage < 30);

    logger.info('\n⚖️ Leverage Distribution (Small Targets):');
    logger.info(`  Ultra-high (>50x): ${ultraHigh.length} positions`);
    logger.info(`  High (30-50x): ${high.length} positions`);
    logger.info(`  Moderate (20-30x): ${moderate.length} positions`);

    // Analyze direction
    const longs = smallTargets.filter(p => p.isLong);
    const shorts = smallTargets.filter(p => !p.isLong);
    logger.info('\n📈 Direction Distribution:');
    logger.info(`  Long: ${longs.length} (${(longs.length/smallTargets.length*100).toFixed(1)}%)`);
    logger.info(`  Short: ${shorts.length} (${(shorts.length/smallTargets.length*100).toFixed(1)}%)`);

    // Save to file
    const outputFile = path.join(__dirname, '../../data/gmx_small_liquidation_targets.json');
    fs.writeFileSync(outputFile, JSON.stringify(smallTargets, null, 2));
    logger.info(`\n✅ Saved ${smallTargets.length} small liquidation targets to: ${outputFile}`);

    // Show top 20 by leverage (realistic ones)
    const top20 = smallTargets
        .sort((a, b) => b.leverage - a.leverage)
        .slice(0, 20);

    logger.info('\n🎯 Top 20 Small High-Leverage Targets:');
    top20.forEach((pos, i) => {
        const direction = pos.isLong ? 'LONG' : 'SHORT';
        logger.info(
            `${i + 1}. ${pos.account.slice(0, 10)}... | ` +
            `${direction} | ` +
            `${pos.leverage.toFixed(1)}x | ` +
            `Size: $${pos.sizeUsd.toFixed(0)} | ` +
            `Collateral: $${pos.collateralUsd.toFixed(0)}`
        );
    });

    // Market breakdown
    logger.info('\n📊 Top Markets (Small Liquidation Targets):');
    const marketCounts = new Map<string, number>();
    smallTargets.forEach(pos => {
        const count = marketCounts.get(pos.market) || 0;
        marketCounts.set(pos.market, count + 1);
    });

    const sortedMarkets = Array.from(marketCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    sortedMarkets.forEach(([market, count]) => {
        logger.info(`  ${market.slice(0, 10)}...: ${count} positions`);
    });

    // Calculate total collateral needed
    const totalCollateral = smallTargets.reduce((sum, p) => sum + p.collateralUsd, 0);
    const avgCollateral = totalCollateral / smallTargets.length;

    logger.info('\n💰 Capital Requirements:');
    logger.info(`  Avg collateral per position: $${avgCollateral.toFixed(2)}`);
    logger.info(`  Your balance: ~$40 USDC.e`);
    logger.info(`  Positions you can liquidate per round: ~${Math.floor(40 / avgCollateral)}`);

    logger.info('='.repeat(80));
}

main().catch(error => {
    logger.error('Error:', error);
    process.exit(1);
});

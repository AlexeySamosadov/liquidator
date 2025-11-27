/**
 * Filter high-risk positions (>50x leverage) from verified positions
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
    logger.info('Filtering High-Risk GMX Positions');
    logger.info('='.repeat(80));

    // Load verified positions
    const dataFile = path.join(__dirname, '../../data/gmx_verified_positions.json');
    const positions: VerifiedPosition[] = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

    logger.info(`Total positions: ${positions.length}`);

    // Parse leverage from the data (already calculated)
    const positionsWithLeverage = positions.map(pos => {
        const leverage = Number(pos.leverage);
        const sizeUsd = Number(pos.sizeInUsd);
        const collateralUsd = sizeUsd / leverage;

        return {
            ...pos,
            leverage,
            sizeUsd,
            collateralUsd
        };
    });

    // Filter high-risk positions
    const highRiskThreshold = 50; // >50x leverage
    const mediumRiskThreshold = 20; // >20x leverage

    const highRisk = positionsWithLeverage.filter(p => p.leverage >= highRiskThreshold);
    const mediumRisk = positionsWithLeverage.filter(p => p.leverage >= mediumRiskThreshold && p.leverage < highRiskThreshold);
    const lowRisk = positionsWithLeverage.filter(p => p.leverage < mediumRiskThreshold && p.leverage > 0);

    logger.info('Risk distribution:');
    logger.info(`  High Risk (>50x): ${highRisk.length} positions`);
    logger.info(`  Medium Risk (20-50x): ${mediumRisk.length} positions`);
    logger.info(`  Low Risk (<20x): ${lowRisk.length} positions`);

    // Get unique markets for high-risk positions
    const highRiskMarkets = new Set(highRisk.map(p => p.market.toLowerCase()));
    logger.info(`\nUnique markets with high-risk positions: ${highRiskMarkets.size}`);

    // Save high-risk positions
    const highRiskFile = path.join(__dirname, '../../data/gmx_high_risk_positions.json');
    fs.writeFileSync(highRiskFile, JSON.stringify(highRisk, null, 2));
    logger.info(`\n✅ Saved ${highRisk.length} high-risk positions to: ${highRiskFile}`);

    // Save medium-risk positions
    const mediumRiskFile = path.join(__dirname, '../../data/gmx_medium_risk_positions.json');
    fs.writeFileSync(mediumRiskFile, JSON.stringify(mediumRisk, null, 2));
    logger.info(`✅ Saved ${mediumRisk.length} medium-risk positions to: ${mediumRiskFile}`);

    // Analyze top 20 highest leverage positions
    const topRisky = highRisk
        .sort((a, b) => b.leverage - a.leverage)
        .slice(0, 20);

    logger.info('\n📊 Top 20 Highest Leverage Positions:');
    topRisky.forEach((pos, i) => {
        logger.info(`${i + 1}. Account: ${pos.account.slice(0, 10)}... | Leverage: ${pos.leverage.toFixed(1)}x | Size: $${pos.sizeUsd.toFixed(0)} | Collateral: $${pos.collateralUsd.toFixed(0)}`);
    });

    // Market breakdown
    logger.info('\n📈 Market Breakdown (High Risk):');
    const marketCounts = new Map<string, number>();
    highRisk.forEach(pos => {
        const count = marketCounts.get(pos.market) || 0;
        marketCounts.set(pos.market, count + 1);
    });

    const sortedMarkets = Array.from(marketCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    sortedMarkets.forEach(([market, count]) => {
        logger.info(`  ${market.slice(0, 10)}...: ${count} positions`);
    });

    logger.info('='.repeat(80));
}

main().catch(error => {
    logger.error('Error:', error);
    process.exit(1);
});

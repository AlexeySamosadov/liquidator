/**
 * Configuration for monitoring small liquidation targets
 * Focus on 31 high-leverage positions with size $100-$1000
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SmallTarget {
    account: string;
    market: string;
    collateralToken: string;
    isLong: boolean;
    sizeUsd: number;
    collateralUsd: number;
    leverage: number;
}

// Load small liquidation targets
export function loadSmallTargets(): SmallTarget[] {
    const dataFile = path.join(__dirname, '../../data/gmx_small_liquidation_targets.json');

    if (!fs.existsSync(dataFile)) {
        throw new Error(`Small targets file not found: ${dataFile}`);
    }

    return JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
}

// Get unique markets from small targets
export function getTargetMarkets(): string[] {
    const targets = loadSmallTargets();
    const markets = new Set(targets.map(t => t.market.toLowerCase()));
    return Array.from(markets);
}

// Get accounts grouped by market
export function getAccountsByMarket(): Map<string, string[]> {
    const targets = loadSmallTargets();
    const marketAccounts = new Map<string, string[]>();

    targets.forEach(target => {
        const market = target.market.toLowerCase();
        const accounts = marketAccounts.get(market) || [];
        accounts.push(target.account.toLowerCase());
        marketAccounts.set(market, accounts);
    });

    return marketAccounts;
}

// Get monitoring configuration
export function getSmallTargetsConfig() {
    const targets = loadSmallTargets();
    const markets = getTargetMarkets();

    return {
        totalTargets: targets.length,
        uniqueMarkets: markets.length,
        markets: markets,
        avgCollateral: targets.reduce((sum, t) => sum + t.collateralUsd, 0) / targets.length,
        avgLeverage: targets.reduce((sum, t) => sum + t.leverage, 0) / targets.length,
        longCount: targets.filter(t => t.isLong).length,
        shortCount: targets.filter(t => !t.isLong).length
    };
}

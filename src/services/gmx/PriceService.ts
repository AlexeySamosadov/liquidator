/**
 * GMX Price Service
 * Fetches real-time token prices from GMX V2 API
 */

import { logger } from '../../utils/logger';
import { MarketPrices, PriceTuple } from '../../contracts/interfaces/IGMXReader';
import { Address } from '../../types';

const GMX_API_URL = 'https://arbitrum-api.gmxinfra.io';

interface GMXTicker {
    tokenAddress: string;
    tokenSymbol: string;
    minPrice: string;
    maxPrice: string;
    updatedAt: number;
}

export class PriceService {
    private prices: Map<string, GMXTicker> = new Map();
    private lastUpdate: number = 0;
    private readonly cacheDurationMs: number = 10000; // 10 seconds

    /**
     * Get latest prices from API
     */
    async updatePrices(): Promise<void> {
        const now = Date.now();
        if (now - this.lastUpdate < this.cacheDurationMs && this.prices.size > 0) {
            return;
        }

        try {
            logger.debug('Fetching GMX prices...');
            const response = await fetch(`${GMX_API_URL}/prices/tickers`);

            if (!response.ok) {
                throw new Error(`Failed to fetch prices: ${response.statusText}`);
            }

            const tickers = await response.json() as GMXTicker[];

            this.prices.clear();
            for (const ticker of tickers) {
                this.prices.set(ticker.tokenAddress.toLowerCase(), ticker);
            }

            this.lastUpdate = now;
            logger.debug(`Updated ${this.prices.size} prices`);
        } catch (error) {
            logger.error('Failed to update prices', error);
            throw error;
        }
    }

    /**
     * Get MarketPrices struct for a specific market
     */
    getMarketPrices(
        indexToken: Address,
        longToken: Address,
        shortToken: Address
    ): MarketPrices {
        return {
            indexTokenPrice: this.getPriceTuple(indexToken),
            longTokenPrice: this.getPriceTuple(longToken),
            shortTokenPrice: this.getPriceTuple(shortToken),
        };
    }

    /**
     * Get PriceTuple for a token
     */
    private getPriceTuple(token: Address): PriceTuple {
        const ticker = this.prices.get(token.toLowerCase());

        if (!ticker) {
            // If price not found, return 0 (this will likely cause revert or fail checks)
            // In production, we might want to throw or handle this better
            logger.warn(`Price not found for token ${token}`);
            return { min: 0n, max: 0n };
        }

        // API returns prices as strings with 30 decimals precision usually, 
        // but we need to check the format.
        // Actually GMX API returns prices as standard decimals (e.g. "65000.50")
        // Contracts expect 30 decimals precision.

        const minPrice = this.parsePriceToBigInt(ticker.minPrice);
        const maxPrice = this.parsePriceToBigInt(ticker.maxPrice);

        return {
            min: minPrice,
            max: maxPrice,
        };
    }

    /**
     * Parse price string to BigInt with 30 decimals
     */
    private parsePriceToBigInt(priceStr: string): bigint {
        try {
            // Split into integer and fraction
            const [integerPart, fractionPart = ''] = priceStr.split('.');

            // We need 30 decimals total
            const decimals = 30;

            // Pad fraction to 30 digits
            const paddedFraction = fractionPart.padEnd(decimals, '0').slice(0, decimals);

            // Combine
            const fullNumberStr = `${integerPart}${paddedFraction}`;

            return BigInt(fullNumberStr);
        } catch (error) {
            logger.error(`Failed to parse price: ${priceStr}`, error);
            return 0n;
        }
    }
}

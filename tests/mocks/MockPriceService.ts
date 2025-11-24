import { Address } from '../../src/types';
import { DEFAULT_TOKEN_DECIMALS, DEFAULT_TOKEN_PRICES, TEST_TOKENS } from '../utils/testData';

export class MockPriceService {
  private prices = new Map<Address, number>(DEFAULT_TOKEN_PRICES);

  private decimals = new Map<Address, number>(DEFAULT_TOKEN_DECIMALS);

  private calls = new Map<string, number>();

  async getTokenPriceUsd(token: Address): Promise<number> {
    const key = token.toLowerCase();
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
    const price = this.prices.get(token);
    if (price === undefined) throw new Error('Price not set');
    return price;
  }

  async getBnbPriceUsd(): Promise<number> {
    const key = 'bnb';
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
    const price = this.prices.get(TEST_TOKENS.WBNB);
    if (price === undefined) {
      throw new Error('WBNB price not set in MockPriceService');
    }
    return price;
  }

  async getUnderlyingDecimals(token: Address): Promise<number> {
    const key = token.toLowerCase();
    this.calls.set(`decimals-${key}`, (this.calls.get(`decimals-${key}`) ?? 0) + 1);
    const dec = this.decimals.get(token);
    if (dec === undefined) throw new Error('Decimals not set');
    return dec;
  }

  setPrice(token: Address, priceUsd: number): void {
    this.prices.set(token, priceUsd);
  }

  setPrices(prices: Map<Address, number>): void {
    prices.forEach((price, token) => this.prices.set(token, price));
  }

  setDecimals(token: Address, decimals: number): void {
    this.decimals.set(token, decimals);
  }

  setTokenData(token: Address, data: { priceUsd: number; decimals: number }): void {
    this.prices.set(token, data.priceUsd);
    this.decimals.set(token, data.decimals);
  }

  useDefaultPrices(): void {
    this.prices = new Map(DEFAULT_TOKEN_PRICES);
    this.decimals = new Map(DEFAULT_TOKEN_DECIMALS);
  }

  getCallCount(key: Address | string): number {
    return this.calls.get(key.toString().toLowerCase()) ?? 0;
  }

  seedCommonTokens(): void {
    this.setPrice(TEST_TOKENS.WBNB, 300);
    this.setPrice(TEST_TOKENS.USDT, 1);
    this.setPrice(TEST_TOKENS.BTCB, 40_000);
    this.setPrice(TEST_TOKENS.ETH, 2_000);
  }
}

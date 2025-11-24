import { Address } from '../../src/types';
// Lightweight mock; cast to `any` when passing where an IPriceOracle is expected.
export class MockPriceOracle {
  private prices = new Map<string, bigint>();

  private calls = new Map<string, number>();

  usdToOraclePrice(usdPrice: number, decimals: number): bigint {
    const normalized = usdPrice.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: 18,
    });
    const [integerPart, fractionalRaw = ''] = normalized.split('.');
    const fractionalPadded = (fractionalRaw + '0'.repeat(18)).slice(0, 18);
    const scaledTo18 = BigInt(`${integerPart}${fractionalPadded}`);

    const exponent = 36 - decimals - 18;
    if (exponent === 0) return scaledTo18;
    if (exponent > 0) return scaledTo18 * this.pow10(exponent);

    const divisor = this.pow10(-exponent);
    return scaledTo18 / divisor;
  }

  private pow10(exp: number): bigint {
    let result = 1n;
    for (let i = 0; i < exp; i += 1) {
      result *= 10n;
    }
    return result;
  }

  setPrice(vToken: Address, price: bigint): void {
    this.prices.set(vToken.toLowerCase(), price);
  }

  setPriceUsd(vToken: Address, priceUsd: number, decimals: number): void {
    this.prices.set(vToken.toLowerCase(), this.usdToOraclePrice(priceUsd, decimals));
  }

  setPrices(prices: Map<Address, bigint>): void {
    prices.forEach((price, token) => this.prices.set(token.toLowerCase(), price));
  }

  async getUnderlyingPrice(vToken: Address): Promise<bigint> {
    const key = vToken.toLowerCase();
    const count = this.calls.get(key) ?? 0;
    this.calls.set(key, count + 1);
    const price = this.prices.get(key);
    if (price === undefined) throw new Error(`Price not set for ${vToken}`);
    return price;
  }
}

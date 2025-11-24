import { formatUnits, parseUnits } from 'ethers';
import { Address, BotConfig, PriceImpactCheck, SwapResult } from '../../src/types';
import { DEFAULT_TOKEN_DECIMALS, DEFAULT_TOKEN_PRICES } from '../utils/testData';

type ImpactCheckRecord = {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedOut: bigint;
  result: PriceImpactCheck;
};

type ImpactCheckOverride = {
  impactPercent: number;
  isAcceptable: boolean;
};

// Lightweight mock for PriceImpactChecker, configurable for tests.
export class MockPriceImpactChecker {
  private impactOverride: ImpactCheckOverride | undefined;

  private maxAllowedImpact: number;

  private minOutMock: bigint | undefined;

  private shouldFail = false;

  private prices = new Map<Address, number>(DEFAULT_TOKEN_PRICES);

  private decimals = new Map<Address, number>(DEFAULT_TOKEN_DECIMALS);

  private history: ImpactCheckRecord[] = [];

  private calls: Record<string, number> = {};

  constructor(config?: BotConfig) {
    this.maxAllowedImpact = config?.maxPriceImpact ?? 0.1;
  }

  mockImpactCheck(impactPercent: number, acceptable: boolean): void {
    this.impactOverride = { impactPercent, isAcceptable: acceptable };
  }

  mockMinAmountOut(minOut: bigint): void {
    this.minOutMock = minOut;
  }

  mockTokenPrice(token: Address, price: number): void {
    this.prices.set(token, price);
  }

  setMaxAllowedImpact(impact: number): void {
    this.maxAllowedImpact = impact;
  }

  syncFromConfig(config: BotConfig): void {
    this.maxAllowedImpact = config.maxPriceImpact;
  }

  shouldFailPriceCheck(fail: boolean): void {
    this.shouldFail = fail;
  }

  async checkPriceImpact(tokenIn: Address, tokenOut: Address, amountIn: bigint, expectedAmountOut: bigint): Promise<PriceImpactCheck> {
    this.calls.checkPriceImpact = (this.calls.checkPriceImpact ?? 0) + 1;

    if (this.shouldFail) {
      const res = {
        expectedAmountOut,
        actualAmountOut: 0n,
        impactPercent: 0,
        isAcceptable: false,
        maxAllowedImpact: this.maxAllowedImpact,
      };
      this.history.push({ tokenIn, tokenOut, amountIn, expectedOut: expectedAmountOut, result: res });
      return res;
    }

    if (this.impactOverride !== undefined) {
      const res: PriceImpactCheck = {
        expectedAmountOut,
        actualAmountOut: expectedAmountOut,
        impactPercent: this.impactOverride.impactPercent,
        isAcceptable: this.impactOverride.isAcceptable,
        maxAllowedImpact: this.maxAllowedImpact,
      };
      this.history.push({ tokenIn, tokenOut, amountIn, expectedOut: expectedAmountOut, result: res });
      return res;
    }

    const priceIn = this.prices.get(tokenIn) ?? 0;
    const priceOut = this.prices.get(tokenOut) ?? 0;
    const decimalsIn = this.decimals.get(tokenIn) ?? 18;
    const decimalsOut = this.decimals.get(tokenOut) ?? 18;

    const humanIn = Number.parseFloat(formatUnits(amountIn, decimalsIn));
    const humanExpectedOut = Number.parseFloat(formatUnits(expectedAmountOut, decimalsOut));
    const expectedUsd = humanIn * priceIn;
    const actualUsd = humanExpectedOut * priceOut;
    const impactPercent = expectedUsd === 0 ? 0 : ((expectedUsd - actualUsd) / expectedUsd);
    const isAcceptable = impactPercent <= this.maxAllowedImpact;

    const res: PriceImpactCheck = {
      expectedAmountOut,
      actualAmountOut: expectedAmountOut,
      impactPercent: Number.isNaN(impactPercent) ? 0 : impactPercent,
      isAcceptable,
      maxAllowedImpact: this.maxAllowedImpact,
    };
    this.history.push({ tokenIn, tokenOut, amountIn, expectedOut: expectedAmountOut, result: res });
    return res;
  }

  async calculateMinAmountOut(
    amountIn: bigint,
    tokenInPrice: number,
    tokenOutPrice: number,
    tokenIn: Address,
    tokenOut: Address,
  ): Promise<bigint> {
    this.calls.calculateMinAmountOut = (this.calls.calculateMinAmountOut ?? 0) + 1;
    if (this.minOutMock !== undefined) return this.minOutMock;
    if (tokenInPrice === 0 || tokenOutPrice === 0) return 0n;

    const decimalsIn = this.decimals.get(tokenIn) ?? 18;
    const decimalsOut = this.decimals.get(tokenOut) ?? 18;
    const humanIn = Number.parseFloat(formatUnits(amountIn, decimalsIn));
    const usdValue = humanIn * tokenInPrice;
    const minUsd = usdValue * (1 - this.maxAllowedImpact);
    const outHuman = minUsd / tokenOutPrice;
    const outWei = parseUnits(outHuman.toFixed(decimalsOut), decimalsOut);
    return outWei > 0 ? outWei : 0n;
  }

  validateSlippage(amountOut: bigint, amountOutMin: bigint, decimalsOut: number): boolean {
    this.calls.validateSlippage = (this.calls.validateSlippage ?? 0) + 1;
    if (amountOut === 0n) return false;
    const actual = Number.parseFloat(formatUnits(amountOut, decimalsOut));
    const minimum = Number.parseFloat(formatUnits(amountOutMin, decimalsOut));
    const slippage = actual === 0 ? Number.POSITIVE_INFINITY : (actual - minimum) / actual;
    return slippage <= this.maxAllowedImpact;
  }

  async getTokenPrice(token: Address): Promise<number> {
    this.calls.getTokenPrice = (this.calls.getTokenPrice ?? 0) + 1;
    const price = this.prices.get(token);
    if (price === undefined) throw new Error('Price not set');
    return price;
  }

  enrichSwapResultWithImpact(result: SwapResult, expectedOut: bigint): SwapResult {
    this.calls.enrichSwapResultWithImpact = (this.calls.enrichSwapResultWithImpact ?? 0) + 1;
    if (!result.amountOut) return result;
    if (expectedOut === 0n || result.amountOut >= expectedOut) return { ...result, priceImpact: 0 };
    const numerator = (expectedOut - result.amountOut) * 1_000_000n;
    const impactPercent = Number(numerator / expectedOut) / 1_000_000;
    return { ...result, priceImpact: impactPercent };
  }

  setDecimals(token: Address, decimals: number): void {
    this.decimals.set(token, decimals);
  }

  getCheckHistory(): ImpactCheckRecord[] {
    return this.history;
  }

  getCallCount(method: string): number {
    return this.calls[method] ?? 0;
  }
}

export default MockPriceImpactChecker;

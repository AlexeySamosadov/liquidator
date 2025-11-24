import { formatUnits, parseUnits } from 'ethers';
import {
  Address,
  BotConfig,
  PriceImpactCheck,
  SwapResult,
} from '../../types';
import { logger } from '../../utils/logger';
import PriceService from '../pricing/PriceService';

class PriceImpactChecker {
  constructor(
    private readonly config: BotConfig,
    private readonly priceService: PriceService,
  ) {}

  /**
   * Compares the USD value implied by oracle prices to the USD value implied by the DEX quote.
   *
   * impactPercent is a unitless fraction between 0 and 1 (e.g., 0.03 = 3%) describing
   * the deviation between oracle-based USD value (amountIn * oracle priceIn) and the
   * DEX-quoted USD value (expectedAmountOut * oracle priceOut). It is not AMM pool
   * slippage; it guards against trading at a materially worse USD rate than the oracle.
   */
  async checkPriceImpact(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    expectedAmountOut: bigint,
  ): Promise<PriceImpactCheck> {
    try {
      const priceIn = await this.priceService.getTokenPriceUsd(tokenIn);
      const priceOut = await this.priceService.getTokenPriceUsd(tokenOut);

      if (priceIn === 0 || priceOut === 0) {
        return {
          expectedAmountOut,
          actualAmountOut: 0n,
          impactPercent: 0,
          isAcceptable: false,
          maxAllowedImpact: this.config.maxPriceImpact,
        };
      }

      const decimalsIn = await this.priceService.getUnderlyingDecimals(tokenIn);
      const decimalsOut = await this.priceService.getUnderlyingDecimals(tokenOut);

      const humanIn = Number.parseFloat(formatUnits(amountIn, decimalsIn));
      const humanExpectedOut = Number.parseFloat(formatUnits(expectedAmountOut, decimalsOut));
      const expectedUsd = humanIn * priceIn;
      const actualUsd = humanExpectedOut * priceOut;
      // Fractional deviation between oracle-implied USD value and DEX-quoted USD value.
      const impactPercent = expectedUsd === 0 ? 0 : ((expectedUsd - actualUsd) / expectedUsd);
      const isAcceptable = impactPercent <= this.config.maxPriceImpact;

      return {
        expectedAmountOut,
        actualAmountOut: expectedAmountOut,
        impactPercent,
        isAcceptable,
        maxAllowedImpact: this.config.maxPriceImpact,
      };
    } catch (error) {
      logger.warn('Price impact check failed', { error: (error as Error).message });
      return {
        expectedAmountOut,
        actualAmountOut: 0n,
        impactPercent: 0,
        isAcceptable: false,
        maxAllowedImpact: this.config.maxPriceImpact,
      };
    }
  }

  validateSlippage(amountOut: bigint, amountOutMin: bigint, decimalsOut: number): boolean {
    if (amountOut === 0n) {
      return false;
    }
    const actual = Number.parseFloat(formatUnits(amountOut, decimalsOut));
    const minimum = Number.parseFloat(formatUnits(amountOutMin, decimalsOut));
    const slippage = actual === 0 ? Number.POSITIVE_INFINITY : (actual - minimum) / actual;
    const ok = slippage <= this.config.slippageTolerance;
    if (!ok) {
      logger.warn('Slippage exceeded tolerance', { slippage, tolerance: this.config.slippageTolerance });
    }
    return ok;
  }

  async calculateMinAmountOut(
    amountIn: bigint,
    tokenInPrice: number,
    tokenOutPrice: number,
    tokenIn: Address,
    tokenOut: Address,
  ): Promise<bigint> {
    if (tokenInPrice === 0 || tokenOutPrice === 0) {
      return 0n;
    }

    const decimalsIn = await this.priceService.getUnderlyingDecimals(tokenIn);
    const decimalsOut = await this.priceService.getUnderlyingDecimals(tokenOut);

    const amountInHuman = Number.parseFloat(formatUnits(amountIn, decimalsIn));
    const usdValue = amountInHuman * tokenInPrice;
    const minUsd = usdValue * (1 - this.config.slippageTolerance);
    const outHuman = minUsd / tokenOutPrice;

    const outWei = parseUnits(outHuman.toFixed(decimalsOut), decimalsOut);
    return outWei > 0 ? outWei : 0n;
  }

  async getTokenPrice(token: Address): Promise<number> {
    return this.priceService.getTokenPriceUsd(token);
  }

  enrichSwapResultWithImpact(result: SwapResult, expectedOut: bigint): SwapResult {
    if (!result.amountOut) {
      return result;
    }

    if (expectedOut === 0n || result.amountOut >= expectedOut) {
      return { ...result, priceImpact: 0 };
    }

    const numerator = (expectedOut - result.amountOut) * 1_000_000n;
    const impactPercent = Number(numerator / expectedOut) / 1_000_000;

    return {
      ...result,
      priceImpact: impactPercent,
    };
  }
}

export default PriceImpactChecker;

import { describe, expect, it, beforeEach } from '@jest/globals';
import { parseUnits } from 'ethers';
import PriceImpactChecker from '../../src/services/dex/PriceImpactChecker';
import { createBotConfig } from '../utils/configFactory';
import { MockPriceService } from '../mocks/MockPriceService';
import { TEST_TOKENS } from '../utils/testData';
import { expectPriceImpactAcceptable, expectPriceImpactRejected } from '../utils/assertions';

describe('PriceImpactChecker', () => {
  let service: MockPriceService;
  let checker: PriceImpactChecker;

  beforeEach(() => {
    service = new MockPriceService();
    checker = new PriceImpactChecker(createBotConfig({ maxPriceImpact: 0.1, slippageTolerance: 0.01 }), service as any);
  });

  it('accepts low impact trades', async () => {
    const amountIn = parseUnits('1', 18);
    const expectedOut = parseUnits('300', 6);
    const res = await checker.checkPriceImpact(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, amountIn, expectedOut);
    expectPriceImpactAcceptable(res);
  });

  it('rejects high impact trades', async () => {
    const amountIn = parseUnits('1', 18);
    const expectedOut = parseUnits('200', 6); // ~33% impact
    const res = await checker.checkPriceImpact(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, amountIn, expectedOut);
    expectPriceImpactRejected(res);
  });

  it('calculates min amount out preserving USD value with slippage', async () => {
    const amountIn = parseUnits('2', 18);
    const minOut = await checker.calculateMinAmountOut(amountIn, 300, 1, TEST_TOKENS.WBNB, TEST_TOKENS.USDT);
    expect(minOut).toBeGreaterThan(0n);
  });

  it('validateSlippage respects tolerance', () => {
    const amountOut = parseUnits('100', 6);
    const amountOutMin = parseUnits('95', 6);
    const ok = checker.validateSlippage(amountOut, amountOutMin, 6);
    expect(ok).toBe(true);
  });

  it('enrichSwapResultWithImpact adds priceImpact field', () => {
    const enriched = checker.enrichSwapResultWithImpact({
      success: true,
      amountIn: parseUnits('1', 18),
      amountOut: parseUnits('90', 6),
      tokenIn: TEST_TOKENS.WBNB,
      tokenOut: TEST_TOKENS.USDT,
    }, parseUnits('100', 6));

    expect(enriched.priceImpact).toBeGreaterThan(0);
  });
});

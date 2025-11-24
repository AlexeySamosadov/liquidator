// Legacy smoke tests; full coverage lives in tests/unit/PriceImpactChecker.test.ts
import { describe, test, expect, beforeEach } from '@jest/globals';
import { parseUnits } from 'ethers';
import PriceImpactChecker from '../src/services/dex/PriceImpactChecker';
import { amountToUsd } from '../src/services/dex/math';
import { Address, BotConfig, CollateralStrategy, LogLevel } from '../src/types';

const stubConfig: BotConfig = {
  rpcUrl: '',
  chainId: 56,
  privateKey: '0xdeadbeef',
  minProfitUsd: 1,
  minPositionSizeUsd: 1,
  maxPositionSizeUsd: 10_000_000,
  gasPriceMultiplier: 1,
  maxGasPriceGwei: 20,
  useFlashLoans: false,
  flashLoanFeeBps: 9,
  collateralStrategy: CollateralStrategy.AUTO_SELL,
  slippageTolerance: 0.05,
  minSwapAmountUsd: 10,
  maxPriceImpact: 0.1,
  preferredStablecoin: '0x0000000000000000000000000000000000000000',
  pollingIntervalMs: 1_000,
  minHealthFactor: 1.05,
  logLevel: LogLevel.DEBUG,
  logToFile: false,
  venus: { comptroller: '0x0000000000000000000000000000000000000000' },
  dex: { pancakeswapRouter: '0x0000000000000000000000000000000000000000' },
};

const stubPriceService = {
  getTokenPriceUsd: async (token: Address): Promise<number> => {
    if (token === 'TOKEN_IN') return 2;
    if (token === 'TOKEN_OUT') return 1;
    return 1;
  },
  getUnderlyingDecimals: async (token: Address): Promise<number> => {
    if (token === 'USDT') return 6;
    if (token === 'TOKEN_IN' || token === 'TOKEN_OUT') return 18;
    return 18;
  },
};

describe('PriceImpactChecker', () => {
  let checker: PriceImpactChecker;

  beforeEach(() => {
    checker = new PriceImpactChecker(stubConfig, stubPriceService as any);
  });

  test('calculates price impact correctly for large trade', async () => {
    const amountIn = parseUnits('1000', 18);
    const expectedOut = parseUnits('1980', 18); // ~1% impact vs fair 2000
    const impact = await checker.checkPriceImpact('TOKEN_IN', 'TOKEN_OUT', amountIn, expectedOut);
    expect(impact.isAcceptable).toBe(true);
    expect(Math.abs(impact.impactPercent - 0.01)).toBeLessThan(1e-6);
  });

  test('calculates min amount out with slippage', async () => {
    const amountIn = parseUnits('1000', 18);
    const minOut = await checker.calculateMinAmountOut(amountIn, 2, 1, 'TOKEN_IN', 'TOKEN_OUT');
    const minOutHuman = Number.parseFloat((minOut / 10n ** 18n).toString());
    expect(minOutHuman).toBeGreaterThan(1890);
    expect(minOutHuman).toBeLessThan(2000);
  });

  test('respects token decimals in USD calculations', () => {
    const usdtDecimals = 6;
    const amountUsdt = parseUnits('1500', usdtDecimals);
    const usdValue = amountToUsd(amountUsdt, 1, usdtDecimals);
    expect(Math.round(usdValue)).toBe(1500);
  });

  test('handles zero amount gracefully', async () => {
    const impact = await checker.checkPriceImpact('TOKEN_IN', 'TOKEN_OUT', 0n, 0n);
    expect(impact.expectedAmountOut).toBe(0n);
    expect(impact.actualAmountOut).toBe(0n);
    expect(impact.isAcceptable).toBe(true);
  });

  test('handles very large amounts without overflow', async () => {
    const amountIn = parseUnits('1000000', 18);
    const expectedOut = parseUnits('1900000', 18);
    const impact = await checker.checkPriceImpact('TOKEN_IN', 'TOKEN_OUT', amountIn, expectedOut);
    expect(impact.maxAllowedImpact).toBeGreaterThan(0);
  });

  test('flags price impact exceeding threshold', async () => {
    const amountIn = parseUnits('10', 18);
    const expectedOut = parseUnits('5', 18); // 50% drop
    const impact = await checker.checkPriceImpact('TOKEN_IN', 'TOKEN_OUT', amountIn, expectedOut);
    expect(impact.isAcceptable).toBe(false);
    expect(impact.impactPercent).toBeGreaterThan(stubConfig.maxPriceImpact);
  });
});

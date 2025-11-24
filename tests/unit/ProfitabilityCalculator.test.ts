import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { FeeData, parseUnits } from 'ethers';
import ProfitabilityCalculator from '../../src/services/liquidation/ProfitabilityCalculator';
import { LiquidationMode } from '../../src/types';
import {
  BNB_PRICE_USD,
  DEFAULT_MAX_FEE_PER_GAS,
  DEFAULT_PRIORITY_FEE,
  FLASH_LOAN_FEE_BPS,
  GAS_MULTIPLIER_DEFAULT,
  MAX_GAS_CAP_GWEI,
  TEST_TOKENS,
  USDT_DECIMALS,
  WBTC_DECIMALS,
  WBNB_DECIMALS,
  createBotConfig,
  createFullMockEnvironment,
  createLiquidatablePosition,
  expectGasEstimateReasonable,
  expectNumberClose,
  expectProfitabilityAnalysis,
} from '../utils';

// contract factory routing to lightweight mocks
let contractFactory: ((address: string) => any) | undefined;
jest.mock('ethers', () => {
  const actual = jest.requireActual<typeof import('ethers')>('ethers');
  const Contract = function (address: string) {
    if (typeof contractFactory === 'function') return contractFactory(address);
    return new actual.Contract(address, [], actual.Wallet.createRandom());
  } as any;
  return { ...actual, Contract };
});

describe('ProfitabilityCalculator', () => {
  const position = createLiquidatablePosition({ repayAmount: parseUnits('1000', 18) });

  let calc: ProfitabilityCalculator;
  let env: ReturnType<typeof createFullMockEnvironment>;
  let config = createBotConfig({
    gasPriceMultiplier: GAS_MULTIPLIER_DEFAULT,
    maxGasPriceGwei: MAX_GAS_CAP_GWEI,
    flashLoanFeeBps: FLASH_LOAN_FEE_BPS,
    minProfitUsd: 10,
  });

  const setFeeData = (feeData: FeeData) => env.provider.setFeeData(feeData);

  beforeEach(() => {
    env = createFullMockEnvironment();
    env.priceService.setPrice(TEST_TOKENS.WBNB, BNB_PRICE_USD);
    calc = new ProfitabilityCalculator(config as any, env.provider as any, env.priceService as any);
    contractFactory = undefined;
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    test('constructs with dependencies', () => {
      expect(calc).toBeDefined();
      expect(typeof calc.estimateGas).toBe('function');
      expect(typeof calc.analyzeProfitability).toBe('function');
    });
  });

  describe('estimateGas - standard', () => {
    test('returns estimate using contract call', async () => {
      const estimateGasMock = jest.fn(async () => 250000n as any);
      contractFactory = () => ({ liquidateBorrow: { estimateGas: estimateGasMock } });
      setFeeData(new FeeData(null, DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE));

      const gasEstimate = await calc.estimateGas({ position, mode: LiquidationMode.STANDARD } as any);

      expect(estimateGasMock).toHaveBeenCalled();
      expect(gasEstimate.estimatedGas).toBe(250000n);
      const expectedMax = BigInt(Math.floor(Number(DEFAULT_MAX_FEE_PER_GAS) * GAS_MULTIPLIER_DEFAULT));
      const expectedPriority = BigInt(Math.floor(Number(DEFAULT_PRIORITY_FEE) * GAS_MULTIPLIER_DEFAULT));
      expect(gasEstimate.maxFeePerGas).toBe(expectedMax);
      expect(gasEstimate.maxPriorityFeePerGas).toBe(expectedPriority);
      expectNumberClose(gasEstimate.gasPriceGwei, Number(expectedMax) / 1e9, 0.0001);
      expectGasEstimateReasonable(gasEstimate, 50);
    });

    test('falls back to base gas when contract estimation fails', async () => {
      contractFactory = () => ({
        liquidateBorrow: { estimateGas: jest.fn(async () => Promise.reject(new Error('fail'))) },
      });
      setFeeData(new FeeData(null, DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE));

      const gasEstimate = await calc.estimateGas({ position, mode: LiquidationMode.STANDARD } as any);

      expect(gasEstimate.estimatedGas).toBe(220000n);
      expectGasEstimateReasonable(gasEstimate, 100);
    });

    test('throws on non-finite BNB cost', async () => {
      const toNumberSpy = jest.spyOn(calc as any, 'toNumberWithScale').mockReturnValueOnce(Infinity);
      setFeeData(new FeeData(null, DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE));

      await expect(calc.estimateGas({ position, mode: LiquidationMode.STANDARD } as any)).rejects.toThrow(
        'non-finite',
      );
      toNumberSpy.mockRestore();
    });

    test('throws on non-finite USD cost', async () => {
      env.priceService.setPrice(TEST_TOKENS.WBNB, Number.POSITIVE_INFINITY);
      setFeeData(new FeeData(null, DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE));

      await expect(calc.estimateGas({ position, mode: LiquidationMode.STANDARD } as any)).rejects.toThrow(
        'non-finite',
      );
    });

    test('throws when normalization overflows', async () => {
      const highConfig = createBotConfig({ maxGasPriceGwei: 1_000_000_000, gasPriceMultiplier: 1 });
      const highCalc = new ProfitabilityCalculator(highConfig as any, env.provider as any, env.priceService as any);
      contractFactory = () => ({
        liquidateBorrow: {
          estimateGas: jest.fn(async () => 10n ** 18n as any),
        },
      });
      setFeeData(new FeeData(null, 10n ** 18n, 0n));

      await expect(highCalc.estimateGas({ position, mode: LiquidationMode.STANDARD } as any)).rejects.toThrow(
        'exceeds safe JS number range',
      );
    });
  });

  describe('estimateGas - flash loan', () => {
    test('adds overhead for flash loan mode', async () => {
      const estimateGasMock = jest.fn(async () => 300000n as any);
      contractFactory = () => ({ liquidateBorrow: { estimateGas: estimateGasMock } });
      setFeeData(new FeeData(null, DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE));

      const gasEstimate = await calc.estimateGas({ position, mode: LiquidationMode.FLASH_LOAN } as any);

      expect(estimateGasMock).toHaveBeenCalled();
      expect(gasEstimate.estimatedGas).toBe(350000n);
      expectGasEstimateReasonable(gasEstimate, 80);
    });
  });

  describe('calculateFlashLoanFee', () => {
    test('handles different decimals', () => {
      const feeUsdt = calc.calculateFlashLoanFee(parseUnits('1000', USDT_DECIMALS), USDT_DECIMALS, 1);
      const feeWbtc = calc.calculateFlashLoanFee(parseUnits('0.1', WBTC_DECIMALS), WBTC_DECIMALS, 40000);
      const feeWbnb = calc.calculateFlashLoanFee(parseUnits('10', WBNB_DECIMALS), WBNB_DECIMALS, 300);

      expectNumberClose(feeUsdt, 0.9, 0.01);
      expectNumberClose(feeWbtc, 3.6, 0.01);
      expectNumberClose(feeWbnb, 2.7, 0.05);
    });

    test('throws on invalid price', () => {
      expect(() => calc.calculateFlashLoanFee(1000n, 18, Number.POSITIVE_INFINITY)).toThrow('Invalid token price');
      expect(() => calc.calculateFlashLoanFee(1000n, 18, Number.NaN)).toThrow('Invalid token price');
    });

    test('handles zero and large amounts', () => {
      expect(calc.calculateFlashLoanFee(0n, 18, 1)).toBe(0);
      const hugeAmount = BigInt(10) ** 24n;
      expect(calc.calculateFlashLoanFee(hugeAmount, 18, 1)).toBeGreaterThan(0);
    });
  });

  describe('analyzeProfitability', () => {
    test('standard profitable scenario', async () => {
      const gasEstimate = { estimatedCostUsd: 10 } as any;
      const analysis = await calc.analyzeProfitability(
        { ...position, estimatedProfitUsd: 100 },
        LiquidationMode.STANDARD,
        gasEstimate,
      );

      expectProfitabilityAnalysis(analysis, true);
      expectNumberClose(analysis.netProfitUsd, 90, 0.001);
      expect(analysis.flashLoanFeeUsd).toBe(0);
      expect(analysis.recommendedMode).toBe(LiquidationMode.STANDARD);
    });

    test('standard unprofitable scenario', async () => {
      const gasEstimate = { estimatedCostUsd: 10 } as any;
      const analysis = await calc.analyzeProfitability(
        { ...position, estimatedProfitUsd: 5 },
        LiquidationMode.STANDARD,
        gasEstimate,
      );

      expectProfitabilityAnalysis(analysis, false);
      expect(analysis.netProfitUsd).toBeCloseTo(-5, 1);
    });

    test('flash loan includes fee and fallback metadata', async () => {
      const gasEstimate = { estimatedCostUsd: 5 } as any;
      const analysis = await calc.analyzeProfitability(
        {
          ...position,
          repayAmount: parseUnits('10000', 18),
          repayTokenDecimals: undefined,
          repayTokenPriceUsd: undefined,
          estimatedProfitUsd: 100,
        },
        LiquidationMode.FLASH_LOAN,
        gasEstimate,
      );

      expect(analysis.flashLoanFeeUsd).toBeGreaterThan(0);
      expectProfitabilityAnalysis(analysis, true);
      expect(analysis.recommendedMode).toBe(LiquidationMode.FLASH_LOAN);
    });

    test('zero debt value sets profit margin to zero', async () => {
      const analysis = await calc.analyzeProfitability(
        { ...position, debtValueUsd: 0, estimatedProfitUsd: 20 },
        LiquidationMode.STANDARD,
        { estimatedCostUsd: 5 } as any,
      );

      expect(analysis.profitMargin).toBe(0);
    });
  });

  describe('estimateGasCostUsdForCandidate', () => {
    test('uses lightweight estimation standard', async () => {
      setFeeData(new FeeData(null, DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE));
      const cost = await calc.estimateGasCostUsdForCandidate(position, LiquidationMode.STANDARD);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(50);
    });

    test('uses lightweight estimation flash loan', async () => {
      setFeeData(new FeeData(null, DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE));
      const cost = await calc.estimateGasCostUsdForCandidate(position, LiquidationMode.FLASH_LOAN);
      expect(cost).toBeGreaterThan(0);
    });

    test('falls back to default on non-finite result', async () => {
      jest.spyOn(env.priceService, 'getBnbPriceUsd').mockResolvedValueOnce(Number.NaN as any);
      const cost = await calc.estimateGasCostUsdForCandidate(position, LiquidationMode.STANDARD);
      expect(cost).toBeCloseTo(0.1, 5);
    });
  });
});

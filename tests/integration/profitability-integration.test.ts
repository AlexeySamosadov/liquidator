import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { FeeData, parseUnits } from 'ethers';
import ProfitabilityCalculator from '../../src/services/liquidation/ProfitabilityCalculator';
import TransactionBuilder from '../../src/services/liquidation/TransactionBuilder';
import { LiquidationMode } from '../../src/types';
import {
  BNB_PRICE_USD,
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

let contractFactory: ((address: string) => any) | undefined;
jest.mock('ethers', () => {
  const actual = jest.requireActual<typeof import('ethers')>('ethers');
  const Contract = function (address: string) {
    if (contractFactory) return contractFactory(address);
    return new actual.Contract(address, [], actual.Wallet.createRandom());
  } as any;
  return { ...actual, Contract };
});

describe('Profitability integration', () => {
  let env: ReturnType<typeof createFullMockEnvironment>;
  let config: ReturnType<typeof createBotConfig>;
  let builder: TransactionBuilder;
  let calculator: ProfitabilityCalculator;

  const setGas = (gwei: number, priorityGwei = 1) => {
    env.provider.setFeeData(
      new FeeData(null, parseUnits(String(gwei), 'gwei'), parseUnits(String(priorityGwei), 'gwei')),
    );
  };

  const basePosition = () => createLiquidatablePosition({ repayAmount: parseUnits('1000', 18) });

  beforeEach(() => {
    env = createFullMockEnvironment();
    env.priceService.setPrice(TEST_TOKENS.WBNB, BNB_PRICE_USD);
    env.priceService.setPrice(TEST_TOKENS.USDT, 1);
    env.priceService.setPrice(TEST_TOKENS.BTCB, 40_000);
    env.priceService.setDecimals(TEST_TOKENS.USDT, USDT_DECIMALS);
    env.priceService.setDecimals(TEST_TOKENS.BTCB, WBTC_DECIMALS);
    env.priceService.setDecimals(TEST_TOKENS.WBNB, WBNB_DECIMALS);

    config = createBotConfig({ maxGasPriceGwei: MAX_GAS_CAP_GWEI, gasPriceMultiplier: 1.1 });
    builder = new TransactionBuilder(config as any, env.provider as any);
    calculator = new ProfitabilityCalculator(config as any, env.provider as any, env.priceService as any);
    contractFactory = () => ({
      liquidateBorrow: { estimateGas: jest.fn(async () => 240000n) },
    });
    setGas(5, 1);
  });

  describe('Gas estimation flow', () => {
    test('standard mode uses TransactionBuilder prices', async () => {
      const spy = jest.spyOn(TransactionBuilder, 'calculateGasPrices');
      const estimate = await calculator.estimateGas({ position: basePosition(), mode: LiquidationMode.STANDARD } as any);

      expect(spy).toHaveBeenCalled();
      expectGasEstimateReasonable(estimate, 100);
      expect(estimate.maxPriorityFeePerGas).toBeGreaterThan(0n);
      spy.mockRestore();
    });

    test('builder gas params mirror calculator inputs', async () => {
      const gasParams = await builder.buildGasParams();
      const estimate = await calculator.estimateGas({ position: basePosition(), mode: LiquidationMode.STANDARD } as any);

      expect(gasParams.maxFeePerGas).toBe(estimate.maxFeePerGas);
      expect(gasParams.maxPriorityFeePerGas).toBe(estimate.maxPriorityFeePerGas);
    });

    test('flash loan adds overhead and higher cost', async () => {
      const standard = await calculator.estimateGas({ position: basePosition(), mode: LiquidationMode.STANDARD } as any);
      const flash = await calculator.estimateGas({ position: basePosition(), mode: LiquidationMode.FLASH_LOAN } as any);

      expect(flash.estimatedGas).toBeGreaterThan(standard.estimatedGas);
      expect(flash.estimatedCostUsd).toBeGreaterThan(standard.estimatedCostUsd);
    });
  });

  describe('Profitability analysis', () => {
    test('profitable standard liquidation', async () => {
      const position = basePosition();
      position.estimatedProfitUsd = 100;
      const gasEstimate = await calculator.estimateGas({ position, mode: LiquidationMode.STANDARD } as any);

      const analysis = await calculator.analyzeProfitability(position, LiquidationMode.STANDARD, gasEstimate);
      expectProfitabilityAnalysis(analysis, true);
      expect(analysis.flashLoanFeeUsd).toBe(0);
      expect(analysis.grossProfitUsd).toBe(100);
    });

    test('unprofitable standard liquidation', async () => {
      const position = basePosition();
      position.estimatedProfitUsd = 5;
      const gasEstimate = await calculator.estimateGas({ position, mode: LiquidationMode.STANDARD } as any);

      const analysis = await calculator.analyzeProfitability(position, LiquidationMode.STANDARD, gasEstimate);
      expectProfitabilityAnalysis(analysis, false);
      expect(analysis.netProfitUsd).toBeLessThan(config.minProfitUsd);
    });

    test('profitable flash loan liquidation with fee', async () => {
      const position = createLiquidatablePosition({
        repayAmount: parseUnits('10000', USDT_DECIMALS),
        repayTokenDecimals: USDT_DECIMALS,
        repayTokenPriceUsd: 1,
        estimatedProfitUsd: 100,
      });

      const gasEstimate = await calculator.estimateGas({ position, mode: LiquidationMode.FLASH_LOAN } as any);
      const analysis = await calculator.analyzeProfitability(position, LiquidationMode.FLASH_LOAN, gasEstimate);

      expect(analysis.flashLoanFeeUsd).toBeCloseTo(9, 2);
      expectProfitabilityAnalysis(analysis, true);
    });

    test('flash loan fee scales with decimals (WBTC, WBNB)', async () => {
      const wbtcPosition = createLiquidatablePosition({
        repayAmount: parseUnits('0.1', WBTC_DECIMALS),
        repayToken: TEST_TOKENS.BTCB,
        repayTokenDecimals: WBTC_DECIMALS,
        repayTokenPriceUsd: 40000,
        estimatedProfitUsd: 200,
      });

      const gasEstimate = await calculator.estimateGas({ position: wbtcPosition, mode: LiquidationMode.FLASH_LOAN } as any);
      const analysis = await calculator.analyzeProfitability(wbtcPosition, LiquidationMode.FLASH_LOAN, gasEstimate);
      expectNumberClose(analysis.flashLoanFeeUsd, 3.6, 0.05);

      const wbnbPosition = createLiquidatablePosition({
        repayAmount: parseUnits('10', WBNB_DECIMALS),
        repayToken: TEST_TOKENS.WBNB,
        repayTokenDecimals: WBNB_DECIMALS,
        repayTokenPriceUsd: BNB_PRICE_USD,
        estimatedProfitUsd: 500,
      });

      const gasEstimate2 = await calculator.estimateGas({ position: wbnbPosition, mode: LiquidationMode.FLASH_LOAN } as any);
      const analysis2 = await calculator.analyzeProfitability(wbnbPosition, LiquidationMode.FLASH_LOAN, gasEstimate2);
      expectNumberClose(analysis2.flashLoanFeeUsd, 2.7, 0.05);
    });
  });

  describe('Gas price variations', () => {
    test('lower gas price improves profitability', async () => {
      setGas(3, 1);
      const lowGasEstimate = await calculator.estimateGas({ position: basePosition(), mode: LiquidationMode.STANDARD } as any);
      const lowProfit = await calculator.analyzeProfitability(basePosition(), LiquidationMode.STANDARD, lowGasEstimate);

      setGas(15, 2);
      const highEstimate = await calculator.estimateGas({ position: basePosition(), mode: LiquidationMode.STANDARD } as any);
      const highProfit = await calculator.analyzeProfitability(basePosition(), LiquidationMode.STANDARD, highEstimate);

      expect(lowProfit.netProfitUsd).toBeGreaterThan(highProfit.netProfitUsd);
    });

    test('throws when gas cap exceeded', async () => {
      setGas(25, 2);
      await expect(
        calculator.estimateGas({ position: basePosition(), mode: LiquidationMode.STANDARD } as any),
      ).rejects.toThrow('Gas price too high');
    });
  });

  describe('Mode comparison', () => {
    test('flash loan costs more than standard', async () => {
      const position = basePosition();
      const standard = await calculator.analyzeProfitability(
        position,
        LiquidationMode.STANDARD,
        await calculator.estimateGas({ position, mode: LiquidationMode.STANDARD } as any),
      );

      const flash = await calculator.analyzeProfitability(
        position,
        LiquidationMode.FLASH_LOAN,
        await calculator.estimateGas({ position, mode: LiquidationMode.FLASH_LOAN } as any),
      );

      expect(flash.gasCostUsd).toBeGreaterThanOrEqual(standard.gasCostUsd);
      expect(flash.flashLoanFeeUsd).toBeGreaterThan(0);
    });
  });

  describe('Lightweight vs full estimation', () => {
    test('candidate estimate close to full estimate', async () => {
      const position = basePosition();
      const light = await calculator.estimateGasCostUsdForCandidate(position, LiquidationMode.STANDARD);
      const full = await calculator.estimateGas({ position, mode: LiquidationMode.STANDARD } as any);

      expectNumberClose(light, full.estimatedCostUsd, full.estimatedCostUsd * 0.2);
    });
  });

  describe('Real world scenarios', () => {
    test('profitable large liquidation', async () => {
      const position = createLiquidatablePosition({
        collateralValueUsd: 50_000,
        debtValueUsd: 30_000,
        repayAmount: parseUnits('15000', 18),
        estimatedProfitUsd: 1_200,
      });

      const gasEstimate = await calculator.estimateGas({ position, mode: LiquidationMode.STANDARD } as any);
      const analysis = await calculator.analyzeProfitability(position, LiquidationMode.STANDARD, gasEstimate);

      expectProfitabilityAnalysis(analysis, true);
      expect(analysis.netProfitUsd).toBeGreaterThan(1000);
    });

    test('unprofitable small liquidation under high gas', async () => {
      setGas(15, 2);
      const position = createLiquidatablePosition({ debtValueUsd: 100, estimatedProfitUsd: 8 });
      const gasEstimate = await calculator.estimateGas({ position, mode: LiquidationMode.STANDARD } as any);
      const analysis = await calculator.analyzeProfitability(position, LiquidationMode.STANDARD, gasEstimate);

      expectProfitabilityAnalysis(analysis, false);
    });
  });
});

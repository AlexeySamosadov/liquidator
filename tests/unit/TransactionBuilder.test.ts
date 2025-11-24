import { beforeEach, describe, expect, test } from '@jest/globals';
import { FeeData, parseUnits } from 'ethers';
import TransactionBuilder from '../../src/services/liquidation/TransactionBuilder';
import {
  GAS_MULTIPLIER_DEFAULT,
  GAS_MULTIPLIER_HIGH,
  MAX_GAS_CAP_GWEI,
  createBotConfig,
  createMockProvider,
  expectNumberClose,
} from '../utils';

describe('TransactionBuilder', () => {
  let provider: ReturnType<typeof createMockProvider>;
  let builder: TransactionBuilder;

  beforeEach(() => {
    provider = createMockProvider();
    builder = new TransactionBuilder(
      createBotConfig({ gasPriceMultiplier: GAS_MULTIPLIER_DEFAULT, maxGasPriceGwei: MAX_GAS_CAP_GWEI }) as any,
      provider as any,
    );
  });

  describe('Initialization', () => {
    test('creates instance with provider and config', () => {
      expect(builder).toBeDefined();
      expect(typeof builder.buildGasParams).toBe('function');
    });
  });

  describe('calculateGasPrices - normal cases', () => {
    test('applies multiplier for EIP-1559 fields', () => {
      const feeData = new FeeData(null, parseUnits('5', 'gwei'), parseUnits('1', 'gwei'));
      const result = TransactionBuilder.calculateGasPrices(
        feeData,
        createBotConfig({ gasPriceMultiplier: GAS_MULTIPLIER_DEFAULT, maxGasPriceGwei: MAX_GAS_CAP_GWEI }),
      );

      expect(result.maxFeePerGas).toBe(BigInt(Math.floor(Number(parseUnits('5', 'gwei')) * GAS_MULTIPLIER_DEFAULT)));
      expect(result.maxPriorityFeePerGas).toBe(
        BigInt(Math.floor(Number(parseUnits('1', 'gwei')) * GAS_MULTIPLIER_DEFAULT)),
      );
      expectNumberClose(result.gasPriceGwei, 5 * GAS_MULTIPLIER_DEFAULT, 0.001);
    });

    test('handles legacy gasPrice fallback', () => {
      const feeData = new FeeData(parseUnits('4', 'gwei'), null, null);
      const result = TransactionBuilder.calculateGasPrices(
        feeData,
        createBotConfig({ gasPriceMultiplier: 1.5, maxGasPriceGwei: MAX_GAS_CAP_GWEI }),
      );

      expect(result.maxFeePerGas).toBe(BigInt(Math.floor(Number(parseUnits('4', 'gwei')) * 1.5)));
      expect(result.maxPriorityFeePerGas).toBe(0n);
    });
  });

  describe('calculateGasPrices - caps and errors', () => {
    test('throws when maxFeePerGas exceeds cap', () => {
      const feeData = new FeeData(null, parseUnits('30', 'gwei'), parseUnits('2', 'gwei'));
      expect(() =>
        TransactionBuilder.calculateGasPrices(
          feeData,
          createBotConfig({ maxGasPriceGwei: MAX_GAS_CAP_GWEI, gasPriceMultiplier: 1.0 }),
        ),
      ).toThrow('Gas price too high');
    });

    test('caps priority fee without throwing', () => {
      const feeData = new FeeData(null, parseUnits('15', 'gwei'), parseUnits('25', 'gwei'));
      const result = TransactionBuilder.calculateGasPrices(
        feeData,
        createBotConfig({ maxGasPriceGwei: MAX_GAS_CAP_GWEI, gasPriceMultiplier: 1 }),
      );

      expect(result.maxPriorityFeePerGas).toBe(BigInt(Math.floor(MAX_GAS_CAP_GWEI * 1e9)));
    });

    test('handles missing fee data by returning zeros', () => {
      const feeData = new FeeData(null, null, null);
      const result = TransactionBuilder.calculateGasPrices(
        feeData,
        createBotConfig({ maxGasPriceGwei: MAX_GAS_CAP_GWEI, gasPriceMultiplier: 1 }),
      );

      expect(result.maxFeePerGas).toBe(0n);
      expect(result.maxPriorityFeePerGas).toBe(0n);
      expect(result.gasPriceGwei).toBe(0);
    });
  });

  describe('calculateGasPrices - multiplier variations', () => {
    test('multiplier 1 leaves values unchanged', () => {
      const feeData = new FeeData(null, parseUnits('5', 'gwei'), parseUnits('1', 'gwei'));
      const result = TransactionBuilder.calculateGasPrices(
        feeData,
        createBotConfig({ gasPriceMultiplier: 1, maxGasPriceGwei: MAX_GAS_CAP_GWEI }),
      );

      expect(result.maxFeePerGas).toBe(parseUnits('5', 'gwei'));
      expect(result.maxPriorityFeePerGas).toBe(parseUnits('1', 'gwei'));
    });

    test('higher multiplier increases gas price', () => {
      const feeData = new FeeData(null, parseUnits('5', 'gwei'), parseUnits('1', 'gwei'));
      const result = TransactionBuilder.calculateGasPrices(
        feeData,
        createBotConfig({ gasPriceMultiplier: GAS_MULTIPLIER_HIGH, maxGasPriceGwei: MAX_GAS_CAP_GWEI }),
      );

      expect(result.maxFeePerGas).toBe(BigInt(Math.floor(Number(parseUnits('5', 'gwei')) * GAS_MULTIPLIER_HIGH)));
    });
  });

  describe('buildGasParams', () => {
    test('pulls fee data from provider', async () => {
      provider.setFeeData(new FeeData(null, parseUnits('6', 'gwei'), parseUnits('2', 'gwei')));
      const params = await builder.buildGasParams();

      expect(params.maxFeePerGas).toBe(BigInt(Math.floor(Number(parseUnits('6', 'gwei')) * GAS_MULTIPLIER_DEFAULT)));
      expect(params.maxPriorityFeePerGas).toBe(
        BigInt(Math.floor(Number(parseUnits('2', 'gwei')) * GAS_MULTIPLIER_DEFAULT)),
      );
    });

    test('propagates provider errors', async () => {
      jest.spyOn(provider, 'getFeeData').mockRejectedValue(new Error('fee-fail'));
      await expect(builder.buildGasParams()).rejects.toThrow('fee-fail');
    });
  });

  describe('estimateGasLimit', () => {
    test('adds 10% buffer', async () => {
      provider.setGasEstimate(200000n);
      const buffered = await builder.estimateGasLimit({ to: '0x', data: '0x', value: 0n });
      expect(buffered).toBe(220000n);
    });

    test('propagates estimation errors', async () => {
      const erroringProvider = createMockProvider();
      jest.spyOn(erroringProvider, 'estimateGas').mockRejectedValue(new Error('fail'));
      const localBuilder = new TransactionBuilder(
        createBotConfig({}) as any,
        erroringProvider as any,
      );

      await expect(localBuilder.estimateGasLimit({ to: '0x', data: '0x', value: 0n })).rejects.toThrow('fail');
    });
  });
});

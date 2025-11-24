import { AbiCoder, parseUnits } from 'ethers';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import FlashLoanLiquidator from '../../src/services/liquidation/FlashLoanLiquidator';
import { LiquidationMode } from '../../src/types';
import {
  createFlashLoanConfig,
  createFullMockEnvironment,
  createLiquidatablePosition,
  expectLiquidationFailure,
  expectLiquidationSuccess,
  TEST_ADDRESSES,
  TEST_TOKENS,
  parseEther,
} from '../utils';
import { MockPancakeFactory } from '../mocks/MockPancakeFactory';
import { MockPancakePool } from '../mocks/MockPancakePool';
import { MockLiquidator } from '../mocks/MockLiquidator';
import { MockProvider } from '../mocks/MockProvider';
import { randomAddress } from '../utils/testHelpers';

let contractFactory: (address: string) => any;
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const Contract = function (address: string) {
    if (typeof contractFactory === 'function') return contractFactory(address);
    return new actual.Contract(address, [], actual.Wallet.createRandom());
  } as any;
  return { ...actual, Contract };
});

describe('FlashLoanLiquidator', () => {
  const gasParams = {
    maxFeePerGas: parseUnits('6', 'gwei'),
    maxPriorityFeePerGas: parseUnits('1', 'gwei'),
  };

  let env: ReturnType<typeof createFullMockEnvironment>;
  let config: ReturnType<typeof createFlashLoanConfig>;
  let factory: MockPancakeFactory;
  let pool: MockPancakePool;
  let flashLiquidator: any;
  let liquidator: FlashLoanLiquidator;

  const registerContractRouting = (poolAddress?: string) => {
    const poolMap = new Map<string, MockPancakePool>();
    if (poolAddress) poolMap.set(poolAddress.toLowerCase(), pool);

    contractFactory = (address: string) => {
      const lower = address.toLowerCase();
      if (lower === config.dex.pancakeswapV3Factory!.toLowerCase()) return factory as any;
      if (lower === (config.flashLiquidatorContract ?? '').toLowerCase()) return flashLiquidator;
      if (poolMap.has(lower)) return poolMap.get(lower) as any;
      return flashLiquidator;
    };
  };

  beforeEach(() => {
    env = createFullMockEnvironment({ provider: new MockProvider() });
    config = createFlashLoanConfig();
    factory = new MockPancakeFactory();
    pool = new MockPancakePool();
    flashLiquidator = {
      executeFlashLiquidation: jest.fn(async () => ({
        hash: randomAddress(),
        wait: async () => ({ gasUsed: 21000n }),
      })) as unknown as ContractTransactionResponse,
    };
    registerContractRouting();
    liquidator = new FlashLoanLiquidator(env.provider as any, config, 10, env.signer as any);
  });

  describe('Initialization', () => {
    test('sets up with provider and config', () => {
      expect(liquidator).toBeDefined();
    });
  });

  describe('Pool finding', () => {
    test('finds pool with WBNB counterparty and fee 500', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      registerContractRouting(TEST_ADDRESSES.poolLow);

      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
      expect(result.mode).toBe(LiquidationMode.FLASH_LOAN);
    });

    test('finds pool with USDT counterparty fee 2500', async () => {
      factory.registerPool(TEST_TOKENS.BTCB, TEST_TOKENS.USDT, 2500, TEST_ADDRESSES.poolMed);
      registerContractRouting(TEST_ADDRESSES.poolMed);
      pool.setTokens(TEST_TOKENS.BTCB, TEST_TOKENS.USDT);

      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.BTCB });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('tries counterparties in priority order and uses USDT when WBNB missing', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.USDT, 500, '0x0000000000000000000000000000000000000000');
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.USDT, 2500, TEST_ADDRESSES.poolMed);
      registerContractRouting(TEST_ADDRESSES.poolMed);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.USDT);

      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('tries different fee tiers and picks first available', async () => {
      factory.registerPool(TEST_TOKENS.ETH, TEST_TOKENS.WBNB, 2500, TEST_ADDRESSES.poolMed);
      registerContractRouting(TEST_ADDRESSES.poolMed);
      pool.setTokens(TEST_TOKENS.ETH, TEST_TOKENS.WBNB);

      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.ETH });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('returns error when pool not found', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDC });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'No suitable flash loan pool found');
    });

    test('ignores zero address pools', async () => {
      const spy = jest.spyOn(factory, 'getPool').mockResolvedValue('0x0000000000000000000000000000000000000000');
      registerContractRouting();
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.BUSD });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(false);
      expect(spy).toHaveBeenCalled();
    });

    test('continues search on factory errors', async () => {
      const spy = jest.spyOn(factory, 'getPool').mockImplementationOnce(async () => {
        throw new Error('factory down');
      }).mockResolvedValueOnce(TEST_ADDRESSES.poolLow);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);

      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Flash loan params', () => {
    test('sets amount0 when repayToken matches token0', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT, repayAmount: parseEther(2) });

      const dataSpy = jest.spyOn(AbiCoder.defaultAbiCoder(), 'encode');
      await liquidator.executeLiquidation(position, gasParams);
      expect(dataSpy).toHaveBeenCalled();
    });

    test('sets amount1 when repayToken is token1', async () => {
      factory.registerPool(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.WBNB, TEST_TOKENS.USDT);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('encodes calldata with borrower and tokens', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT, seizeToken: TEST_TOKENS.BUSD });

      await liquidator.executeLiquidation(position, gasParams);
      const calldata = (flashLiquidator.executeFlashLiquidation as jest.Mock).mock.calls[0][5];
      const decoded = AbiCoder.defaultAbiCoder().decode(['address', 'address', 'address', 'uint256'], calldata);
      expect(decoded[0]).toBe(position.borrower);
      expect(decoded[1]).toBe(position.repayToken);
      expect(decoded[2]).toBe(position.seizeToken);
      expect(decoded[3]).toBe(position.repayAmount);
    });

    test('uses flashLoanFeeBps from config', async () => {
      config = createFlashLoanConfig({ flashLoanFeeBps: 9 });
      liquidator = new FlashLoanLiquidator(env.provider as any, config, 12, env.signer as any);
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);

      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
      expect(result.flashLoanFee).toBe(9);
    });

    test('handles case-insensitive token comparison', async () => {
      const upperToken = TEST_TOKENS.USDT.toUpperCase();
      factory.registerPool(upperToken, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(upperToken as string, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);

      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });
  });

  describe('Execution', () => {
    test('runs flash loan liquidation successfully', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT, estimatedProfitUsd: 120 });

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationSuccess(result);
      expect(result.mode).toBe(LiquidationMode.FLASH_LOAN);
      expect(result.flashLoanFee).toBe(config.flashLoanFeeBps);
    });

    test('calls executeFlashLiquidation with correct params', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });

      await liquidator.executeLiquidation(position, gasParams);
      expect(flashLiquidator.executeFlashLiquidation).toHaveBeenCalledWith(
        TEST_ADDRESSES.poolLow,
        position.repayToken,
        position.seizeToken,
        position.borrower,
        position.repayAmount,
        expect.any(String),
        {
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        },
      );
    });

    test('passes gas parameters', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });

      await liquidator.executeLiquidation(position, gasParams);
      const callArgs = (flashLiquidator.executeFlashLiquidation as jest.Mock).mock.calls[0][6];
      expect(callArgs.maxFeePerGas).toBe(gasParams.maxFeePerGas);
      expect(callArgs.maxPriorityFeePerGas).toBe(gasParams.maxPriorityFeePerGas);
    });

    test('populates LiquidationResult fields', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT, estimatedProfitUsd: 300 });

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.txHash).toBeDefined();
      expect(result.liquidationBonus).toBe(10);
      expect(result.gasPriceGwei).toBeCloseTo(Number(gasParams.maxFeePerGas) / 1e9);
      expect(result.profitUsd).toBe(position.estimatedProfitUsd);
    });
  });

  describe('Missing flash liquidator contract', () => {
    test('returns error when contract undefined', async () => {
      config = createFlashLoanConfig({ flashLiquidatorContract: undefined });
      liquidator = new FlashLoanLiquidator(env.provider as any, config, 10, env.signer as any);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'Flash liquidator contract not deployed');
    });

    test('returns error when contract null', async () => {
      config = createFlashLoanConfig({ flashLiquidatorContract: null as any });
      liquidator = new FlashLoanLiquidator(env.provider as any, config, 10, env.signer as any);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'use standard liquidation');
    });
  });

  describe('Error handling', () => {
    test('handles missing pool', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'No suitable flash loan pool found');
    });

    test('handles executeFlashLiquidation revert', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      flashLiquidator.executeFlashLiquidation = jest.fn(async () => {
        throw new Error('Flash loan failed');
      });
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'Flash loan failed');
    });

    test('handles token0/token1 retrieval errors', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      (pool as any).token0 = jest.fn(async () => {
        throw new Error('token0 error');
      });
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'token0 error');
    });

    test('handles calldata encoding errors', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const encodeSpy = jest.spyOn(AbiCoder.defaultAbiCoder(), 'encode').mockImplementation(() => {
        throw new Error('encode fail');
      });
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'encode fail');
      encodeSpy.mockRestore();
    });

    test('handles provider errors', async () => {
      const badProvider = new MockProvider();
      jest.spyOn(badProvider, 'getBlockNumber').mockRejectedValue(new Error('network down'));
      liquidator = new FlashLoanLiquidator(badProvider as any, config, 10, env.signer as any);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('handles various decimals', async () => {
      const tokens = [TEST_TOKENS.USDT, TEST_TOKENS.BUSD, TEST_TOKENS.USDC];
      factory.registerPool(tokens[0], TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(tokens[0], TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      for (const token of tokens) {
        const position = createLiquidatablePosition({ repayToken: token, repayAmount: parseUnits('1', 18) });
        const result = await liquidator.executeLiquidation(position, gasParams);
        expect(result.success).toBe(true);
      }
    });

    test('handles very large amounts', async () => {
      const huge = 10n ** 25n;
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT, repayAmount: huge });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('handles dust amounts', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT, repayAmount: 1n });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('handles all counterparties', async () => {
      const counterparts = [TEST_TOKENS.WBNB, TEST_TOKENS.USDT, TEST_TOKENS.BUSD];
      const fees = [500, 2500, 10000];
      counterparts.forEach((c, idx) => factory.registerPool(TEST_TOKENS.BTCB, c, fees[idx], TEST_ADDRESSES.poolLow));
      pool.setTokens(TEST_TOKENS.BTCB, counterparts[1]);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.BTCB });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('handles all fee tiers', async () => {
      const fees = [500, 2500, 10000];
      fees.forEach((fee) => factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, fee, TEST_ADDRESSES.poolLow));
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });
  });

  describe('Factory integration', () => {
    test('calls factory for each counterparty/fee combination', async () => {
      const spy = jest.spyOn(factory, 'getPool');
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      await liquidator.executeLiquidation(position, gasParams);
      expect(spy).toHaveBeenCalledTimes(9);
    });

    test('stops after first pool found', async () => {
      const spy = jest.spyOn(factory, 'getPool');
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      await liquidator.executeLiquidation(position, gasParams);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('skips failed requests and continues', async () => {
      const spy = jest.spyOn(factory, 'getPool').mockImplementationOnce(async () => {
        throw new Error('first failed');
      }).mockResolvedValueOnce(TEST_ADDRESSES.poolLow);
      registerContractRouting(TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      const position = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});

import { AbiCoder, parseUnits } from 'ethers';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import StandardLiquidator from '../../src/services/liquidation/StandardLiquidator';
import FlashLoanLiquidator from '../../src/services/liquidation/FlashLoanLiquidator';
import { LiquidationMode } from '../../src/types';
import {
  createFlashLoanConfig,
  createFullMockEnvironment,
  createLiquidatablePosition,
  expectLiquidationFailure,
  expectLiquidationSuccess,
  parseEther,
  TEST_ADDRESSES,
  TEST_TOKENS,
  TEST_VTOKENS,
} from '../utils';
import { MockERC20 } from '../mocks/MockERC20';
import { MockVToken } from '../mocks/MockVToken';
import { MockPancakeFactory } from '../mocks/MockPancakeFactory';
import { MockPancakePool } from '../mocks/MockPancakePool';
import { MockProvider } from '../mocks/MockProvider';
import { randomAddress } from '../utils/testHelpers';

// Route ethers.Contract creations to lightweight mocks used in the tests below.
let contractFactory: (address: string) => any;
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as any;
  const Contract = function (address: string) {
    if (typeof contractFactory === 'function') return contractFactory(address);
    return new actual.Contract(address, [], actual.Wallet.createRandom());
  } as any;
  return { ...actual, Contract };
});

describe('Liquidators integration behavior', () => {
  const gasParams = {
    maxFeePerGas: parseUnits('7', 'gwei'),
    maxPriorityFeePerGas: parseUnits('1', 'gwei'),
  };

  let env: ReturnType<typeof createFullMockEnvironment>;
  let standard: StandardLiquidator;
  let flash: FlashLoanLiquidator;
  let config: ReturnType<typeof createFlashLoanConfig>;
  let repayToken: MockERC20;
  let repayVToken: MockVToken;
  let factory: MockPancakeFactory;
  let pool: MockPancakePool;
  let flashContract: any;

  const registerContractRouting = (poolAddress?: string) => {
    contractFactory = (address: string) => {
      const lower = address.toLowerCase();
      if (lower === TEST_TOKENS.USDT.toLowerCase()) return repayToken as any;
      if (lower === (config.dex.pancakeswapV3Factory ?? '').toLowerCase()) return factory as any;
      if (lower === (config.flashLiquidatorContract ?? '').toLowerCase()) return flashContract;
      if (poolAddress && lower === poolAddress.toLowerCase()) return pool as any;
      return repayToken as any;
    };
  };

  beforeEach(() => {
    env = createFullMockEnvironment({ provider: new MockProvider() });
    config = createFlashLoanConfig();
    repayToken = new MockERC20();
    repayToken.setCaller((env.signer as any).address);
    repayVToken = new MockVToken({ underlying: TEST_TOKENS.USDT, symbol: 'vUSDT', decimals: 8 });
    env.venusContracts.setVToken(TEST_VTOKENS.vUSDT, repayVToken);

    factory = new MockPancakeFactory();
    pool = new MockPancakePool();
    flashContract = {
      executeFlashLiquidation: jest.fn(async () => ({
        hash: randomAddress(),
        wait: async () => ({ gasUsed: 21000n }),
      })),
    };

    registerContractRouting();
    standard = new StandardLiquidator(env.venusContracts as any, env.signer as any, 8);
    flash = new FlashLoanLiquidator(env.provider as any, config, 10, env.signer as any);
  });

  describe('Outcome differences with shared state', () => {
    test('Standard fails on insufficient balance while flash loan succeeds when pool exists', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);

      repayToken.setBalance((env.signer as any).address, 0n);

      const basePosition = createLiquidatablePosition({
        repayToken: TEST_VTOKENS.vUSDT,
        repayAmount: parseEther(2),
        seizeToken: TEST_TOKENS.WBNB,
      });

      const standardResult = await standard.executeLiquidation(basePosition, gasParams);
      expectLiquidationFailure(standardResult, 'Insufficient balance');

      const flashPosition = {
        ...basePosition,
        repayToken: TEST_TOKENS.USDT.toLowerCase(),
        seizeToken: basePosition.seizeToken.toLowerCase(),
      };
      const flashResult = await flash.executeLiquidation(flashPosition, gasParams);

      expectLiquidationSuccess(flashResult);
      expect(flashResult.mode).toBe(LiquidationMode.FLASH_LOAN);
    });

    test('Both succeed but preserve their modes and result shapes', async () => {
      repayToken.setBalance((env.signer as any).address, parseEther(5));
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);

      const basePosition = createLiquidatablePosition({
        repayToken: TEST_VTOKENS.vUSDT,
        estimatedProfitUsd: 75,
        repayAmount: parseEther(1),
      });

      const standardResult = await standard.executeLiquidation(basePosition, gasParams);
      expectLiquidationSuccess(standardResult);
      expect(standardResult.mode).toBe(LiquidationMode.STANDARD);

      const flashPosition = {
        ...basePosition,
        repayToken: TEST_TOKENS.USDT.toLowerCase(),
        seizeToken: basePosition.seizeToken.toLowerCase(),
      };
      const flashResult = await flash.executeLiquidation(flashPosition, gasParams);
      expectLiquidationSuccess(flashResult);
      expect(flashResult.mode).toBe(LiquidationMode.FLASH_LOAN);
      expect(flashResult.gasPriceGwei).toBeCloseTo(Number(gasParams.maxFeePerGas) / 1e9);
    });
  });

  describe('Gas parameter forwarding', () => {
    test('StandardLiquidator and FlashLoanLiquidator forward gas params correctly', async () => {
      repayToken.setBalance((env.signer as any).address, parseEther(3));
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);

      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, seizeToken: TEST_TOKENS.BUSD, repayAmount: parseEther(1) });
      const vTokenSpy = jest.spyOn(repayVToken as any, 'liquidateBorrow');

      await standard.executeLiquidation(position, gasParams);
      expect(vTokenSpy).toHaveBeenCalledWith(position.borrower, position.repayAmount, position.seizeToken, {
        maxFeePerGas: gasParams.maxFeePerGas,
        maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        value: 0n,
      });

      const flashPosition = {
        ...position,
        repayToken: TEST_TOKENS.USDT.toLowerCase(),
        seizeToken: position.seizeToken.toLowerCase(),
      };
      await flash.executeLiquidation(flashPosition, gasParams);
      const flashCall = (flashContract.executeFlashLiquidation as jest.Mock).mock.calls[0];
      expect(flashCall[6]).toEqual({
        maxFeePerGas: gasParams.maxFeePerGas,
        maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
      });
    });
  });

  describe('Consistent error reporting', () => {
    test('Both report errors when dependencies revert or are missing', async () => {
      // Standard fails because ERC20 calls revert
      repayToken.shouldRevert(true, 'ERC20 paused');
      const standardPosition = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT });
      const standardResult = await standard.executeLiquidation(standardPosition, gasParams);
      expectLiquidationFailure(standardResult, 'ERC20 paused');

      // Flash fails because pool discovery throws
      jest.spyOn(factory, 'getPool').mockImplementation(async () => {
        throw new Error('factory unreachable');
      });
      registerContractRouting();
      const flashPosition = {
        ...standardPosition,
        repayToken: TEST_TOKENS.USDT.toLowerCase(),
        seizeToken: standardPosition.seizeToken.toLowerCase(),
      };
      const flashResult = await flash.executeLiquidation(flashPosition, gasParams);
      expectLiquidationFailure(flashResult, 'flash loan pool');
    });

    test('Handles malformed calldata encoding gracefully', async () => {
      factory.registerPool(TEST_TOKENS.USDT, TEST_TOKENS.WBNB, 500, TEST_ADDRESSES.poolLow);
      pool.setTokens(TEST_TOKENS.USDT, TEST_TOKENS.WBNB);
      registerContractRouting(TEST_ADDRESSES.poolLow);

      const encodeSpy = jest.spyOn(AbiCoder.defaultAbiCoder(), 'encode').mockImplementation(() => {
        throw new Error('encode broke');
      });

      const flashPosition = createLiquidatablePosition({ repayToken: TEST_TOKENS.USDT });
      const flashResult = await flash.executeLiquidation(flashPosition, gasParams);
      expectLiquidationFailure(flashResult, 'encode broke');

      encodeSpy.mockRestore();
    });
  });
});

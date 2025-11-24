import { beforeEach, describe, expect, test } from '@jest/globals';
import { parseUnits } from 'ethers';
import StandardLiquidator from '../../src/services/liquidation/StandardLiquidator';
import { LiquidationMode } from '../../src/types';
import {
  createFullMockEnvironment,
  createLiquidatablePosition,
  expectLiquidationFailure,
  expectLiquidationSuccess,
  TEST_TOKENS,
  TEST_VTOKENS,
  parseEther,
  randomAddress,
} from '../utils';
import { MockERC20 } from '../mocks/MockERC20';
import { MockVToken } from '../mocks/MockVToken';

// Contract constructor mock routing to lightweight mocks
let contractFactory: (address: string) => any;
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const Contract = function (address: string) {
    if (typeof contractFactory === 'function') return contractFactory(address);
    return new actual.Contract(address, [], actual.Wallet.createRandom());
  } as any;
  return { ...actual, Contract };
});

describe('StandardLiquidator', () => {
  const gasParams = {
    maxFeePerGas: parseUnits('5', 'gwei'),
    maxPriorityFeePerGas: parseUnits('1', 'gwei'),
  };

  let liquidator: StandardLiquidator;
  let repayVToken: MockVToken;
  let repayErc20: MockERC20;
  let env: ReturnType<typeof createFullMockEnvironment>;

  const setupMocks = (underlying: string | null = TEST_TOKENS.USDT): void => {
    repayVToken = new MockVToken({ underlying, symbol: 'vMOCK', decimals: 8 });
    repayErc20 = new MockERC20();
    repayErc20.setCaller((env.signer as any).address);

    env.venusContracts.setVToken(TEST_VTOKENS.vUSDT, repayVToken);

    contractFactory = (address: string) => {
      if (address.toLowerCase() === (underlying ?? '').toLowerCase()) {
        repayErc20.setCaller((env.signer as any).address);
        return repayErc20 as any;
      }
      return repayErc20 as any;
    };
  };

  beforeEach(() => {
    env = createFullMockEnvironment();
    setupMocks();
    liquidator = new StandardLiquidator(env.venusContracts as any, env.signer as any, 8);
  });

  describe('Initialization', () => {
    test('should initialize with dependencies', () => {
      expect(liquidator).toBeDefined();
      expect(typeof liquidator.executeLiquidation).toBe('function');
    });
  });

  describe('Balance Checks', () => {
    test('uses native balance for vBNB market', async () => {
      setupMocks(null);
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vWBNB });
      env.provider.setBalance((env.signer as any).address, position.repayAmount + 1n);
      env.venusContracts.setVToken(TEST_VTOKENS.vWBNB, repayVToken);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('checks ERC20 balance when underlying exists', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseEther(1) });
      repayErc20.setBalance((env.signer as any).address, parseEther(2));

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.mode).toBe(LiquidationMode.STANDARD);
      expect(result.success).toBe(true);
    });

    test('fails when native balance is insufficient', async () => {
      setupMocks(null);
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vWBNB, repayAmount: parseEther(5) });
      env.provider.setBalance((env.signer as any).address, parseEther(1));
      env.venusContracts.setVToken(TEST_VTOKENS.vWBNB, repayVToken);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'Insufficient balance');
    });

    test('fails when ERC20 balance is insufficient', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseEther(5) });
      repayErc20.setBalance((env.signer as any).address, parseEther(1));

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'Insufficient balance');
    });
  });

  describe('Token approval', () => {
    test('skips approve when allowance is sufficient', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT });
      repayErc20.setBalance((env.signer as any).address, position.repayAmount);
      repayErc20.setAllowance((env.signer as any).address, TEST_VTOKENS.vUSDT, position.repayAmount + 1n);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
      expect(repayErc20.getApproveHistory().length).toBe(0);
    });

    test('approves token when allowance is low', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseEther(2) });
      repayErc20.setBalance((env.signer as any).address, parseEther(3));
      repayErc20.setAllowance((env.signer as any).address, TEST_VTOKENS.vUSDT, 0n);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
      const approve = repayErc20.getApproveHistory()[0];
      expect(approve.spender).toBe(TEST_VTOKENS.vUSDT);
      expect(approve.amount).toBe(position.repayAmount);
    });

    test('uses vToken as spender in approve', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseEther(1) });
      repayErc20.setBalance((env.signer as any).address, parseEther(2));

      await liquidator.executeLiquidation(position, gasParams);
      const approve = repayErc20.getApproveHistory()[0];
      expect(approve.spender).toBe(TEST_VTOKENS.vUSDT);
    });

    test('does not approve for native token market', async () => {
      setupMocks(null);
      env.venusContracts.setVToken(TEST_VTOKENS.vWBNB, repayVToken);
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vWBNB, repayAmount: parseEther(1) });
      env.provider.setBalance((env.signer as any).address, parseEther(2));

      await liquidator.executeLiquidation(position, gasParams);
      expect(repayErc20.getApproveHistory().length).toBe(0);
    });
  });

  describe('Liquidation execution', () => {
    test('executes liquidation with ERC20 token', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, seizeToken: TEST_TOKENS.WBNB });
      repayErc20.setBalance((env.signer as any).address, position.repayAmount);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationSuccess(result);
      expect(result.mode).toBe(LiquidationMode.STANDARD);
      expect(result.repayAmount).toBe(position.repayAmount);
      expect(result.seizeToken).toBe(position.seizeToken);
    });

    test('executes liquidation with native token', async () => {
      setupMocks(null);
      env.venusContracts.setVToken(TEST_VTOKENS.vWBNB, repayVToken);
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vWBNB, repayAmount: parseEther(1) });
      env.provider.setBalance((env.signer as any).address, parseEther(2));

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('passes gas parameters to liquidateBorrow', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseEther(1) });
      repayErc20.setBalance((env.signer as any).address, parseEther(2));

      const spy = jest.spyOn(repayVToken as any, 'liquidateBorrow');
      await liquidator.executeLiquidation(position, gasParams);

      expect(spy).toHaveBeenCalledWith(position.borrower, position.repayAmount, position.seizeToken, {
        maxFeePerGas: gasParams.maxFeePerGas,
        maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        value: 0n,
      });
    });

    test('fills LiquidationResult fields', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, estimatedProfitUsd: 75 });
      repayErc20.setBalance((env.signer as any).address, position.repayAmount);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
      expect(result.liquidationBonus).toBe(8);
      expect(result.profitUsd).toBe(position.estimatedProfitUsd);
      expect(result.gasPriceGwei).toBeCloseTo(Number(gasParams.maxFeePerGas) / 1e9);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('Error handling', () => {
    test('propagates insufficient balance error', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseEther(10) });
      repayErc20.setBalance((env.signer as any).address, 0n);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'Insufficient balance');
    });

    test('handles liquidateBorrow revert', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT });
      repayErc20.setBalance((env.signer as any).address, position.repayAmount);
      repayVToken.mockLiquidateBorrow(false);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result);
    });

    test('handles approve failure', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseEther(1) });
      repayErc20.setBalance((env.signer as any).address, parseEther(2));
      repayErc20.shouldRevert(true, 'Approve failed');

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result, 'Approve failed');
    });

    test('handles underlying lookup error', async () => {
      const badVToken = new MockVToken();
      (badVToken as any).underlying = async () => {
        throw new Error('bad underlying');
      };
      env.venusContracts.setVToken(TEST_VTOKENS.vBUSD, badVToken);
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vBUSD });
      env.provider.setBalance((env.signer as any).address, position.repayAmount + 1n);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('fails when signer has no provider for native token', async () => {
      setupMocks(null);
      (env.signer as any).provider = undefined;
      env.venusContracts.setVToken(TEST_VTOKENS.vWBNB, repayVToken);
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vWBNB });

      const result = await liquidator.executeLiquidation(position, gasParams);
      expectLiquidationFailure(result);
    });
  });

  describe('Edge cases', () => {
    test('handles different decimals', async () => {
      const decimals = [6, 8, 18];
      for (const dec of decimals) {
        const vToken = new MockVToken({ underlying: TEST_TOKENS.USDT, decimals: dec });
        env.venusContracts.setVToken(TEST_VTOKENS.vUSDT, vToken);
        repayErc20.setBalance((env.signer as any).address, parseEther(2));
        const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: 10n ** BigInt(dec) });
        const result = await liquidator.executeLiquidation(position, gasParams);
        expect(result.success).toBe(true);
      }
    });

    test('handles very large repay amount', async () => {
      const bigAmount = 10n ** 24n;
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: bigAmount });
      repayErc20.setBalance((env.signer as any).address, bigAmount + 1n);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('handles dust amounts', async () => {
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: 1n });
      repayErc20.setBalance((env.signer as any).address, 10n);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
    });

    test('resolves borrower with random address', async () => {
      const borrower = randomAddress();
      const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, borrower });
      repayErc20.setBalance((env.signer as any).address, position.repayAmount);

      const result = await liquidator.executeLiquidation(position, gasParams);
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
    });
  });
});

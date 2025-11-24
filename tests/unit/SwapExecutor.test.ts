import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Contract, EventLog, Interface, Log } from 'ethers';
import SwapExecutor from '../../src/services/dex/SwapExecutor';
import { createBotConfig } from '../utils/configFactory';
import { TEST_ADDRESSES, TEST_TOKENS, DUST_AMOUNT } from '../utils/testData';
import { createMockTransactionReceipt, createMockTransactionResponse, randomAddress } from '../utils/testHelpers';

// Helpers
const buildExecutor = () => {
  const router: any = {
    target: TEST_ADDRESSES.router,
    connect: () => router,
  };

  const signer: any = { address: TEST_ADDRESSES.liquidator, provider: {} };
  const config = createBotConfig();
  const executor = new SwapExecutor(router, signer, config);
  return { router, signer, executor };
};

class MockERC20 {
  public allowance: jest.Mock<any, any>;
  public approve: jest.Mock<any, any>;
  public decimals: jest.Mock<any, any>;
  public balanceOf: jest.Mock<any, any>;

  constructor(allowance: bigint = 0n) {
    this.allowance = jest.fn().mockResolvedValue(allowance);
    this.approve = jest.fn().mockResolvedValue(createMockTransactionResponse({ success: true }));
    this.decimals = jest.fn().mockResolvedValue(18);
    this.balanceOf = jest.fn().mockResolvedValue(0n);
  }
}

const createMockERC20 = (allowance: bigint = 0n) => {
  return new MockERC20(allowance);
};

const createTransferLog = (
  token: string,
  from: string,
  to: string,
  value: bigint,
): Log => {
  const iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const encoded = iface.encodeEventLog(iface.getEvent('Transfer')!, [from, to, value]);
  return {
    address: token,
    topics: encoded.topics,
    data: encoded.data,
  } as Log;
};

describe('SwapExecutor', () => {
  describe('executeSingleHopSwap', () => {
    it('executes single-hop swap and returns success result', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutSingle').mockResolvedValue(1n);

      const receipt = createMockTransactionReceipt({ hash: '0xabc', status: 1, gasUsed: 21000n });
      const tx: any = createMockTransactionResponse({ hash: '0xabc', success: true });
      tx.wait = async () => receipt as any;
      router.exactInputSingle = async () => tx as any;

      const result = await executor.executeSingleHopSwap({
        path: [TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        amountIn: 1000n,
        amountOutMin: 0n,
        fee: 500,
        deadline: Date.now() / 1000 + 60,
        recipient: TEST_ADDRESSES.liquidator,
      }, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xabc');
      expect(result.amountIn).toBe(1000n);
      expect(result.tokenIn).toBe(TEST_TOKENS.WBNB);
      expect(result.tokenOut).toBe(TEST_TOKENS.USDT);
      expect(result.gasUsed).toBe(21000n);
    });

    it('derives amountOut from transaction logs', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutSingle').mockResolvedValue(1n);

      const logs = [
        createTransferLog(TEST_TOKENS.USDT, randomAddress(), TEST_ADDRESSES.liquidator, 950n),
      ];
      const receipt = createMockTransactionReceipt({ hash: '0xdef', status: 1, gasUsed: 25000n });
      receipt.logs = logs;
      const tx: any = createMockTransactionResponse({ hash: '0xdef', success: true });
      tx.wait = async () => receipt as any;
      router.exactInputSingle = async () => tx as any;

      const result = await executor.executeSingleHopSwap({
        path: [TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        amountIn: 1000n,
        amountOutMin: 0n,
        fee: 500,
        deadline: Date.now() / 1000 + 60,
        recipient: TEST_ADDRESSES.liquidator,
      }, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });

      expect(result.success).toBe(true);
      expect(result.amountOut).toBe(950n);
    });

    it('handles zero amountOut when missing logs', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutSingle').mockResolvedValue(1n);

      const receipt = createMockTransactionReceipt({ hash: '0xghi', status: 1, gasUsed: 25000n });
      receipt.logs = [];
      const tx: any = createMockTransactionResponse({ hash: '0xghi', success: true });
      tx.wait = async () => receipt as any;
      router.exactInputSingle = async () => tx as any;

      const result = await executor.executeSingleHopSwap({
        path: [TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        amountIn: 1000n,
        amountOutMin: 0n,
        fee: 500,
        deadline: Date.now() / 1000 + 60,
        recipient: TEST_ADDRESSES.liquidator,
      }, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });

      expect(result.success).toBe(true);
      expect(result.amountOut).toBe(undefined);
    });

    it('returns failure on router revert', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutSingle').mockResolvedValue(1n);

      router.exactInputSingle = async () => { throw new Error('revert'); };

      const result = await executor.executeSingleHopSwap({
        path: [TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        amountIn: 1000n,
        amountOutMin: 0n,
        fee: 500,
        deadline: Date.now() / 1000 + 60,
        recipient: TEST_ADDRESSES.liquidator,
      }, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });

      expect(result.success).toBe(false);
      expect(result.error).toContain('revert');
    });

    it('handles zero amountIn gracefully', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutSingle').mockResolvedValue(0n);

      const receipt = createMockTransactionReceipt({ hash: '0xzero', status: 1, gasUsed: 21000n });
      const tx: any = createMockTransactionResponse({ hash: '0xzero', success: true });
      tx.wait = async () => receipt as any;
      router.exactInputSingle = jest.fn().mockResolvedValue(tx);

      const result = await executor.executeSingleHopSwap({
        path: [TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        amountIn: 0n,
        amountOutMin: 0n,
        fee: 500,
        deadline: Date.now() / 1000 + 60,
        recipient: TEST_ADDRESSES.liquidator,
      }, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });

      expect(result.success).toBe(true);
      expect(router.exactInputSingle).toHaveBeenCalled();
    });
  });

  describe('executeMultiHopSwap', () => {
    it('executes multi-hop swap and returns success result', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutMulti').mockResolvedValue(1n);

      const path = [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT];
      const recipient = TEST_ADDRESSES.liquidator;
      const expectedOut = 1000n;

      const logs = [createTransferLog(TEST_TOKENS.USDT, randomAddress(), recipient, expectedOut)];
      const receipt = createMockTransactionReceipt({ hash: '0xmulti', status: 1, gasUsed: 35000n });
      receipt.logs = logs;
      const tx: any = createMockTransactionResponse({ hash: '0xmulti', success: true });
      tx.wait = async () => receipt as any;
      router.exactInput = jest.fn().mockResolvedValue(tx);
      const encodePathSpy = jest.spyOn(executor as any, 'encodePath');

      const result = await executor.executeMultiHopSwap(
        path,
        [500, 500],
        0_1n,
        0n,
        { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
        recipient
      );

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xmulti');
      expect(result.amountOut).toBe(expectedOut);
      expect(result.tokenIn).toBe(TEST_TOKENS.BTCB);
      expect(result.tokenOut).toBe(TEST_TOKENS.USDT);
      expect(router.exactInput).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.any(String),
          recipient: expect.any(String),
          amountIn: expect.any(BigInt),
          amountOutMinimum: expect.any(BigInt),
        }),
        expect.any(Object)
      );
      expect(encodePathSpy).toHaveBeenCalledWith(path, [500, 500]);
    });

    it('handles zero amountOut when missing logs', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutMulti').mockResolvedValue(1n);

      const path = [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT];
      const receipt = createMockTransactionReceipt({ hash: '0xmultizero', status: 1, gasUsed: 35000n });
      receipt.logs = [];
      const tx: any = createMockTransactionResponse({ hash: '0xmultizero', success: true });
      tx.wait = async () => receipt as any;
      router.exactInput = jest.fn().mockResolvedValue(tx);

      const result = await executor.executeMultiHopSwap(
        path,
        [500, 500],
        0_1n,
        0n,
        { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
        TEST_ADDRESSES.liquidator
      );

      expect(result.success).toBe(true);
      expect(result.amountOut).toBe(undefined);
    });

    it('returns failure on router revert', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutMulti').mockResolvedValue(1n);

      router.exactInput = async () => { throw new Error('multi-hop revert'); };

      const result = await executor.executeMultiHopSwap(
        [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        [500, 500],
        0_1n,
        0n,
        { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
        TEST_ADDRESSES.liquidator
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('multi-hop revert');
    });

    it('handles zero amountIn gracefully', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutMulti').mockResolvedValue(0n);

      const receipt = createMockTransactionReceipt({ hash: '0xmultizero', status: 1, gasUsed: 35000n });
      const tx: any = createMockTransactionResponse({ hash: '0xmultizero', success: true });
      tx.wait = async () => receipt as any;
      router.exactInput = jest.fn().mockResolvedValue(tx);

      const result = await executor.executeMultiHopSwap(
        [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        [500, 500],
        0n,
        0n,
        { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
        TEST_ADDRESSES.liquidator
      );

      expect(result.success).toBe(true);
      expect(router.exactInput).toHaveBeenCalled();
    });

    it('handles three-hop path', async () => {
      const { executor, router } = buildExecutor();
      jest.spyOn(executor as any, 'approveTokenIfNeeded').mockResolvedValue(undefined as any);
      jest.spyOn(executor as any, 'ensureMinAmountOutMulti').mockResolvedValue(1n);

      const path = [TEST_TOKENS.ETH, TEST_TOKENS.WBNB, TEST_TOKENS.USDT, TEST_TOKENS.BUSD];
      const expectedOut = 500n;
      const logs = [createTransferLog(TEST_TOKENS.BUSD, randomAddress(), TEST_ADDRESSES.liquidator, expectedOut)];
      const receipt = createMockTransactionReceipt({ hash: '0xthreehop', status: 1, gasUsed: 45000n });
      receipt.logs = logs;
      const tx: any = createMockTransactionResponse({ hash: '0xthreehop', success: true });
      tx.wait = async () => receipt as any;
      router.exactInput = jest.fn().mockResolvedValue(tx);

      const result = await executor.executeMultiHopSwap(
        path,
        [500, 500, 500],
        0_5n,
        0n,
        { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
        TEST_ADDRESSES.liquidator
      );

      expect(result.success).toBe(true);
      expect(result.tokenIn).toBe(TEST_TOKENS.ETH);
      expect(result.tokenOut).toBe(TEST_TOKENS.BUSD);
    });
  });

  describe('encodePath', () => {
    it('encodes multi-hop path correctly', () => {
      const { executor } = buildExecutor();
      const tokens = [TEST_TOKENS.WBNB.toLowerCase(), TEST_TOKENS.USDT.toLowerCase(), TEST_TOKENS.BUSD.toLowerCase()];
      const fees = [500, 500];
      const encoded = (executor as any).encodePath(tokens, fees);

      expect(encoded.startsWith('0x')).toBe(true);
      expect(encoded.length).toBeGreaterThan(2);
      const last = `0x${encoded.slice(encoded.length - 40)}`;
      expect(last.toLowerCase()).toBe(TEST_TOKENS.BUSD.toLowerCase());
    });

    it('throws on invalid path/fee lengths', () => {
      const { executor } = buildExecutor();
      const invalidPaths = [
        { path: [TEST_TOKENS.WBNB], fees: [] }, // 1 token, 0 fees
        { path: [TEST_TOKENS.WBNB, TEST_TOKENS.USDT], fees: [500, 500] }, // 2 tokens, 2 fees
        { path: [TEST_TOKENS.WBNB, TEST_TOKENS.USDT, TEST_TOKENS.BUSD], fees: [500] }, // 3 tokens, 1 fee
      ];

      invalidPaths.forEach(({ path, fees }) => {
        expect(() => (executor as any).encodePath(path, fees)).toThrow('Invalid path/fee lengths for encoding');
      });
    });

    it('handles single-hop path encoding', () => {
      const { executor } = buildExecutor();
      const tokens = [TEST_TOKENS.WBNB, TEST_TOKENS.USDT];
      const fees: number[] = [];
      const encoded = (executor as any).encodePath(tokens, fees);

      expect(encoded.startsWith('0x')).toBe(true);
      const last = `0x${encoded.slice(encoded.length - 40)}`;
      expect(last.toLowerCase()).toBe(TEST_TOKENS.USDT.toLowerCase());
    });
  });

  describe('approveTokenIfNeeded', () => {
    it('skips approval when allowance >= amount', async () => {
      const { executor, router } = buildExecutor();
      const token = randomAddress();
      const amount = 1000n;

      const erc20 = createMockERC20(amount);
      jest.spyOn(Contract as any, 'getContract').mockReturnValue(erc20);

      await (executor as any).approveTokenIfNeeded(token, router.target, amount);

      expect(erc20.allowance).toHaveBeenCalledWith(TEST_ADDRESSES.liquidator, router.target);
      expect(erc20.approve).not.toHaveBeenCalled();
    });

    it('approves when allowance < amount', async () => {
      const { executor, router } = buildExecutor();
      const token = randomAddress();
      const amount = 1000n;
      const allowance = 500n;

      const tx = createMockTransactionResponse({ hash: '0xapprove', success: true });
      const erc20 = {
        allowance: jest.fn().mockResolvedValue(allowance),
        approve: jest.fn().mockReturnValue(tx),
        decimals: jest.fn().mockResolvedValue(18),
        balanceOf: jest.fn().mockResolvedValue(0n),
      };
      jest.spyOn(Contract as any, 'getContract').mockReturnValue(erc20);

      await (executor as any).approveTokenIfNeeded(token, router.target, amount);

      expect(erc20.allowance).toHaveBeenCalledWith(TEST_ADDRESSES.liquidator, router.target);
      expect(erc20.approve).toHaveBeenCalledWith(router.target, amount);
    });

    it('waits for approval transaction', async () => {
      const { executor, router } = buildExecutor();
      const token = randomAddress();
      const amount = 1000n;
      const allowance = 0n;

      const receipt = createMockTransactionReceipt({ hash: '0xapprovewait', status: 1, gasUsed: 50000n });
      const tx: any = createMockTransactionResponse({ hash: '0xapprovewait', success: true });
      tx.wait = jest.fn().mockResolvedValue(receipt);
      const erc20 = {
        allowance: jest.fn().mockResolvedValue(allowance),
        approve: jest.fn().mockReturnValue(tx),
        decimals: jest.fn().mockResolvedValue(18),
        balanceOf: jest.fn().mockResolvedValue(0n),
      };
      jest.spyOn(Contract as any, 'getContract').mockReturnValue(erc20);

      await (executor as any).approveTokenIfNeeded(token, router.target, amount);

      expect(tx.wait).toHaveBeenCalled();
    });

    it('handles zero amount approval', async () => {
      const { executor, router } = buildExecutor();
      const token = randomAddress();

      const erc20 = createMockERC20(0n);
      jest.spyOn(Contract as any, 'getContract').mockReturnValue(erc20);

      await (executor as any).approveTokenIfNeeded(token, router.target, 0n);

      expect(erc20.allowance).toHaveBeenCalled();
      expect(erc20.approve).not.toHaveBeenCalled();
    });
  });

  describe('ensureMinAmountOutSingle', () => {
    it('returns explicit providedMin when > 0', async () => {
      const { executor } = buildExecutor();
      const explicitMin = 500n;

      const result = await (executor as any).ensureMinAmountOutSingle(
        TEST_TOKENS.WBNB,
        TEST_TOKENS.USDT,
        1000n,
        500,
        explicitMin
      );

      expect(result).toBe(explicitMin);
    });

    it('derives minAmount from quote when providedMin = 0', async () => {
      const { executor, router } = buildExecutor();
      const quote = 1000n;
      router.callStatic = {
        exactInputSingle: jest.fn().mockResolvedValue(quote),
      } as any;

      const result = await (executor as any).ensureMinAmountOutSingle(
        TEST_TOKENS.WBNB,
        TEST_TOKENS.USDT,
        1000n,
        500,
        0n
      );

      expect(router.callStatic.exactInputSingle).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenIn: TEST_TOKENS.WBNB,
          tokenOut: TEST_TOKENS.USDT,
          fee: 500,
          amountIn: 1000n,
          amountOutMinimum: 0n,
        })
      );
      const slippageBps = Math.floor(executor['config'].slippageTolerance * 10000);
      const expectedMin = (quote * (10000n - BigInt(slippageBps))) / 10000n;
      expect(result).toBe(expectedMin);
    });

    it('returns providedMin when quote fails', async () => {
      const { executor, router } = buildExecutor();
      router.callStatic = {
        exactInputSingle: jest.fn().mockRejectedValue(new Error('quote failed')),
      } as any;

      const result = await (executor as any).ensureMinAmountOutSingle(
        TEST_TOKENS.WBNB,
        TEST_TOKENS.USDT,
        1000n,
        500,
        500n
      );

      expect(result).toBe(500n);
    });

    it('returns 0n when quote fails and no providedMin', async () => {
      const { executor, router } = buildExecutor();
      router.callStatic = {
        exactInputSingle: jest.fn().mockRejectedValue(new Error('quote failed')),
      } as any;

      const result = await (executor as any).ensureMinAmountOutSingle(
        TEST_TOKENS.WBNB,
        TEST_TOKENS.USDT,
        1000n,
        500
      );

      expect(result).toBe(0n);
    });

    it('correctly applies slippage tolerance', async () => {
      const { executor, router } = buildExecutor();
      const quote = 10000n;
      router.callStatic = {
        exactInputSingle: jest.fn().mockResolvedValue(quote),
      } as any;

      const result = await (executor as any).ensureMinAmountOutSingle(
        TEST_TOKENS.WBNB,
        TEST_TOKENS.USDT,
        1000n,
        500,
        0n
      );

      const slippageBps = Math.floor(executor['config'].slippageTolerance * 10000);
      const expectedMin = (quote * (10000n - BigInt(slippageBps))) / 10000n;
      expect(result).toBe(expectedMin);
    });
  });

  describe('ensureMinAmountOutMulti', () => {
    it('returns explicit providedMin when > 0', async () => {
      const { executor } = buildExecutor();
      const explicitMin = 1000n;

      const result = await (executor as any).ensureMinAmountOutMulti(
        [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        [500, 500],
        0_1n,
        explicitMin
      );

      expect(result).toBe(explicitMin);
    });

    it('derives minAmount from quote when providedMin = 0', async () => {
      const { executor, router } = buildExecutor();
      const quote = 5000n;
      router.callStatic = {
        exactInput: jest.fn().mockResolvedValue(quote),
      } as any;

      const result = await (executor as any).ensureMinAmountOutMulti(
        [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        [500, 500],
        0_1n,
        0n
      );

      expect(router.callStatic.exactInput).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.any(String),
          amountIn: 0_1n,
          amountOutMinimum: 0n,
        })
      );
      const slippageBps = Math.floor(executor['config'].slippageTolerance * 10000);
      const expectedMin = (quote * (10000n - BigInt(slippageBps))) / 10000n;
      expect(result).toBe(expectedMin);
    });

    it('returns providedMin when quote fails', async () => {
      const { executor, router } = buildExecutor();
      router.callStatic = {
        exactInput: jest.fn().mockRejectedValue(new Error('quote failed')),
      } as any;

      const providedMin = 100n;
      const result = await (executor as any).ensureMinAmountOutMulti(
        [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        [500, 500],
        0_1n,
        providedMin
      );

      expect(result).toBe(providedMin);
    });

    it('returns 0n when quote fails and no providedMin', async () => {
      const { executor, router } = buildExecutor();
      router.callStatic = {
        exactInput: jest.fn().mockRejectedValue(new Error('quote failed')),
      } as any;

      const result = await (executor as any).ensureMinAmountOutMulti(
        [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        [500, 500],
        0_1n,
        0n
      );

      expect(result).toBe(0n);
    });

    it('correctly applies slippage tolerance for multi-hop', async () => {
      const { executor, router } = buildExecutor();
      const quote = 10000n;
      router.callStatic = {
        exactInput: jest.fn().mockResolvedValue(quote),
      } as any;

      const result = await (executor as any).ensureMinAmountOutMulti(
        [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT],
        [500, 500],
        0_1n,
        0n
      );

      const slippageBps = Math.floor(executor['config'].slippageTolerance * 10000);
      const expectedMin = (quote * (10000n - BigInt(slippageBps))) / 10000n;
      expect(result).toBe(expectedMin);
    });
  });

  describe('estimateSwapOutput', () => {
    it('uses callStatic exactInputSingle', async () => {
      const { executor, router } = buildExecutor();
      router.callStatic = {
        exactInputSingle: async () => 123n as any,
      } as any;

      const out = await executor.estimateSwapOutput(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, 1_000n, 500);
      expect(out).toBe(123n);
    });

    it('returns 0n on estimation failure', async () => {
      const { executor, router } = buildExecutor();
      router.callStatic = {
        exactInputSingle: jest.fn().mockRejectedValue(new Error('estimation failed')),
      } as any;

      const out = await executor.estimateSwapOutput(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, 1_000n, 500);
      expect(out).toBe(0n);
    });
  });

  describe('deriveAmountOutFromLogs', () => {
    it('computes net delta from logs', () => {
      const { executor } = buildExecutor();
      const iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
      const transferEvent = iface.getEvent('Transfer') as any;
      const log = iface.encodeEventLog(transferEvent, [
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        100,
      ]);
      (executor as any).getNetTokenDelta = () => 100n;
      const result = (executor as any).deriveAmountOutFromLogs([
        {
          address: TEST_TOKENS.USDT,
          topics: log.topics,
          data: log.data,
        },
      ], TEST_TOKENS.USDT, '0x0000000000000000000000000000000000000002');

      expect(result).toBe(100n);
    });

    it('returns undefined for empty logs', () => {
      const { executor } = buildExecutor();
      const result = (executor as any).deriveAmountOutFromLogs([], TEST_TOKENS.USDT, TEST_ADDRESSES.liquidator);
      expect(result).toBe(undefined);
    });

    it('returns undefined for zero net delta', () => {
      const { executor } = buildExecutor();
      (executor as any).getNetTokenDelta = () => 0n;
      const result = (executor as any).deriveAmountOutFromLogs([
        {
          address: TEST_TOKENS.USDT,
          topics: [],
          data: '0x',
        },
      ], TEST_TOKENS.USDT, TEST_ADDRESSES.liquidator);
      expect(result).toBe(undefined);
    });

    it('calculates net delta correctly for multiple transfers', () => {
      const { executor } = buildExecutor();
      const account = '0xACC0000000000000000000000000000000000000';
      const other = '0x0TH3R00000000000000000000000000000000000';

      const logs = [
        createTransferLog(TEST_TOKENS.USDT, other, account, 1000n),
        createTransferLog(TEST_TOKENS.USDT, account, other, 300n),
      ];

      const result = (executor as any).getNetTokenDelta(logs, TEST_TOKENS.USDT, account);
      expect(result).toBe(700n);
    });

    it('returns undefined when no matching transfer events', () => {
      const { executor } = buildExecutor();
      const logs = [
        createTransferLog(TEST_TOKENS.BUSD, randomAddress(), randomAddress(), 1000n),
      ];

      const result = (executor as any).getNetTokenDelta(logs, TEST_TOKENS.USDT, TEST_ADDRESSES.liquidator);
      expect(result).toBe(undefined);
    });
  });
});

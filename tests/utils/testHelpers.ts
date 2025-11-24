import { expect } from '@jest/globals';
import { formatUnits, parseUnits } from 'ethers';
import { TransactionReceipt, TransactionResponse } from 'ethers';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const expectToRevert = async (promise: Promise<any>, expectedError?: string): Promise<void> => {
  await expect(promise).rejects.toThrow(expectedError ?? '');
};

export const expectToSucceed = async <T>(promise: Promise<T>): Promise<T> => {
  const result = await promise;
  expect(result).toBeDefined();
  return result;
};

export const parseEther = (value: string | number): bigint => parseUnits(String(value), 18);
export const parseUsdt = (value: string | number): bigint => parseUnits(String(value), 6);
export const formatEther = (value: bigint): string => formatUnits(value, 18);
export const formatUsdt = (value: bigint): string => formatUnits(value, 6);

export const toBigInt = (value: number | string): bigint => BigInt(value);
export const toNumber = (value: bigint): number => Number(value);

export const randomAddress = (): string => {
  const random = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `0x${random}`;
};

export const randomHash = (): string => randomAddress().padEnd(66, '0');

export const advanceTime = async (seconds: number): Promise<void> => {
  // lightweight stub for async timing to keep the parameter used
  await sleep(Math.max(seconds, 0) * 1000);
};

export const getCurrentTimestamp = (): number => Math.floor(Date.now() / 1000);

export const expectBigIntEqual = (actual: bigint, expected: bigint, tolerance: bigint = 0n): void => {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(diff <= tolerance).toBe(true);
};

export const expectNumberClose = (actual: number, expected: number, tolerance: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

export const createMockTransactionReceipt = (params: {
  hash: string;
  status: number;
  gasUsed: bigint;
}): TransactionReceipt =>
  ({
    to: null,
    from: randomAddress(),
    contractAddress: null,
    transactionIndex: 0,
    gasUsed: params.gasUsed,
    logsBloom: '',
    blockHash: randomHash(),
    transactionHash: params.hash,
    logs: [],
    blockNumber: 0,
    confirmations: async () => 1,
    cumulativeGasUsed: params.gasUsed,
    effectiveGasPrice: 0n,
    status: params.status,
    type: 2,
    byzantium: true,
    getBlock: async () => ({ number: 0, timestamp: Date.now() / 1000 }),
    getTransaction: async () => createMockTransactionResponse({ hash: params.hash, success: true }),
    getResult: async () => '0x',
    fee: 0n,
    removedEvent: () => 'removed' as any,
    reorderedEvent: () => 'reordered' as any,
  } as unknown as TransactionReceipt);

export const createMockTransactionResponse = (params: {
  hash?: string;
  success: boolean;
  gasUsed?: bigint;
  waitDelayMs?: number;
}): TransactionResponse => {
  const hash = params.hash ?? randomHash();
  const gasUsed = params.gasUsed ?? 0n;

  return {
    hash,
    from: randomAddress(),
    to: randomAddress(),
    data: '0x',
    value: 0n,
    nonce: 0,
    gasLimit: gasUsed,
    chainId: 56,
    gasPrice: 0n,
    type: 2,
    wait: async () => {
      if (params.waitDelayMs) await sleep(params.waitDelayMs);
      return createMockTransactionReceipt({ hash, status: params.success ? 1 : 0, gasUsed });
    },
  } as unknown as TransactionResponse;
};

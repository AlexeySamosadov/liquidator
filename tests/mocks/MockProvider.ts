import { FeeData, TransactionReceipt } from 'ethers';
import { Address } from '../../src/types';
import { createMockTransactionReceipt } from '../utils/testHelpers';

type CallKey = string;

// NOTE: Lightweight mock; not extending ethers.JsonRpcProvider. Cast to `any` when a real provider type is required.
export class MockProvider {
  private blockNumber = 1;

  private balances = new Map<string, bigint>();

  private gasPrice: bigint = 5_000_000_000n; // 5 gwei

  private feeData: FeeData = new FeeData(this.gasPrice, null, null);

  private gasEstimate: bigint = 200_000n;

  private callResults = new Map<CallKey, string>();

  private receipts = new Map<string, TransactionReceipt>();

  private history: Record<string, any[]> = {};

  setBlockNumber(blockNumber: number): void {
    this.blockNumber = blockNumber;
  }

  setBalance(address: Address, balance: bigint): void {
    this.balances.set(address.toLowerCase(), balance);
  }

  setGasPrice(price: bigint): void {
    this.gasPrice = price;
    this.feeData = new FeeData(price, this.feeData.maxFeePerGas, this.feeData.maxPriorityFeePerGas);
  }

  setFeeData(feeData: FeeData): void {
    this.feeData = feeData;
  }

  setGasEstimate(estimate: bigint): void {
    this.gasEstimate = estimate;
  }

  mockCall(to: Address, data: string, result: string): void {
    this.callResults.set(`${to.toLowerCase()}-${data}`, result);
  }

  advanceBlock(blocks: number): void {
    this.blockNumber += blocks;
  }

  record(method: string, args: any[]): void {
    if (!this.history[method]) this.history[method] = [];
    this.history[method].push(args);
  }

  async getBlockNumber(): Promise<number> {
    this.record('getBlockNumber', []);
    return this.blockNumber;
  }

  async getBlock(_blockNumber: number): Promise<any> {
    this.record('getBlock', [_blockNumber]);
    return { number: _blockNumber, timestamp: Date.now() };
  }

  async getBalance(address: Address): Promise<bigint> {
    this.record('getBalance', [address]);
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }

  async getGasPrice(): Promise<bigint> {
    this.record('getGasPrice', []);
    return this.gasPrice;
  }

  async getFeeData(): Promise<FeeData> {
    this.record('getFeeData', []);
    return this.feeData;
  }

  async estimateGas(_tx: any): Promise<bigint> {
    this.record('estimateGas', [_tx]);
    return this.gasEstimate;
  }

  async call(tx: { to: Address; data: string }): Promise<string> {
    this.record('call', [tx]);
    const result = this.callResults.get(`${tx.to.toLowerCase()}-${tx.data}`);
    if (!result) throw new Error('Call result not mocked');
    return result;
  }

  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt> {
    this.record('getTransactionReceipt', [txHash]);
    const existing = this.receipts.get(txHash);
    if (existing) return existing;
    const receipt = createMockTransactionReceipt({ hash: txHash, status: 1, gasUsed: this.gasEstimate });
    this.receipts.set(txHash, receipt);
    return receipt;
  }

  async waitForTransaction(txHash: string): Promise<TransactionReceipt> {
    this.record('waitForTransaction', [txHash]);
    return this.getTransactionReceipt(txHash);
  }

  setReceipt(txHash: string, receipt: TransactionReceipt): void {
    this.receipts.set(txHash, receipt);
  }
}

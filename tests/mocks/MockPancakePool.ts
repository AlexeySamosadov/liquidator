import { ContractTransactionResponse } from 'ethers';
import { Address } from '../../src/types';
import { createMockTransactionResponse } from '../utils/testHelpers';

type FlashRecord = {
  recipient: Address;
  amount0: bigint;
  amount1: bigint;
  data: string;
  feeCharged: bigint;
};

// Lightweight mock; cast to `any` when passing where an IPancakeV3Pool is expected.
export class MockPancakePool {
  private token0Address: Address = '0x0000000000000000000000000000000000000000';

  private token1Address: Address = '0x0000000000000000000000000000000000000000';

  private feeTier = 500;

  private flashSuccess = true;

  private txHash: string | undefined;

  private revertReason: string | undefined;

  private feeBps = 30; // default 0.3%

  private history: FlashRecord[] = [];

  setTokens(token0: Address, token1: Address): void {
    this.token0Address = token0;
    this.token1Address = token1;
  }

  setFee(fee: number): void {
    this.feeTier = fee;
  }

  setFlashLoanFee(feeBps: number): void {
    this.feeBps = feeBps;
  }

  mockFlashLoan(success: boolean, txHash?: string): void {
    this.flashSuccess = success;
    this.txHash = txHash;
  }

  shouldRevert(revert: boolean, reason?: string): void {
    this.revertReason = revert ? reason ?? 'Flash loan reverted' : undefined;
  }

  async flash(recipient: Address, amount0: bigint, amount1: bigint, data: string): Promise<ContractTransactionResponse> {
    if (this.revertReason) throw new Error(this.revertReason);
    if (!this.flashSuccess) throw new Error('Flash loan failed');

    const feeAmount0 = (amount0 * BigInt(this.feeBps)) / 10_000n;
    const feeAmount1 = (amount1 * BigInt(this.feeBps)) / 10_000n;
    const feeCharged = feeAmount0 + feeAmount1;
    this.history.push({ recipient, amount0, amount1, data, feeCharged });

    return createMockTransactionResponse({ hash: this.txHash, success: true }) as unknown as ContractTransactionResponse;
  }

  async token0(): Promise<Address> {
    return this.token0Address;
  }

  async token1(): Promise<Address> {
    return this.token1Address;
  }

  async fee(): Promise<number> {
    return this.feeTier;
  }

  getFlashHistory(): FlashRecord[] {
    return this.history;
  }
}

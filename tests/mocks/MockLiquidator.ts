import { ContractTransactionResponse } from 'ethers';
import { Address } from '../../src/types';
import { createMockTransactionResponse } from '../utils/testHelpers';

type LiquidationCall = {
  vTokenBorrowed: Address;
  borrower: Address;
  repayAmount: bigint;
  vTokenCollateral: Address;
};

// Lightweight mock; cast to `any` when passing where an ILiquidator is expected.
export class MockLiquidator {
  private success = true;

  private txHash: string | undefined;

  private revertReason: string | undefined;

  private calls: LiquidationCall[] = [];

  private failureMessage: string | undefined;

  mockLiquidateBorrow(success: boolean, txHash?: string, error?: string): void {
    this.success = success;
    this.txHash = txHash;
    this.failureMessage = error;
  }

  shouldRevert(revert: boolean, reason?: string): void {
    this.revertReason = revert ? reason ?? 'Reverted' : undefined;
  }

  setLiquidationResult(params: { success: boolean; seizeAmount?: bigint; gasUsed?: bigint }): void {
    this.success = params.success;
    this.txHash = params.success ? undefined : this.txHash;
  }

  async liquidateBorrow(
    vTokenBorrowed: Address,
    borrower: Address,
    repayAmount: bigint,
    vTokenCollateral: Address,
  ): Promise<ContractTransactionResponse> {
    this.calls.push({ vTokenBorrowed, borrower, repayAmount, vTokenCollateral });
    if (this.revertReason) {
      throw new Error(this.revertReason);
    }
    if (!this.success) {
      throw new Error(this.failureMessage ?? 'Liquidation failed');
    }
    return createMockTransactionResponse({ hash: this.txHash, success: true }) as unknown as ContractTransactionResponse;
  }

  getCallHistory(): LiquidationCall[] {
    return this.calls;
  }
}

import { BigNumberish, ContractTransactionResponse } from 'ethers';
import { ExactInputSingleParams, ExactInputParams } from '../../src/contracts/interfaces/IPancakeSwapV3Router';
import { createMockTransactionResponse } from '../utils/testHelpers';

type SwapRecord = {
  type: 'single' | 'multi';
  params: ExactInputSingleParams | ExactInputParams;
  amountOut: bigint;
};

// Lightweight mock; cast to `any` when passing where an IPancakeSwapV3Router is expected.
export class MockPancakeRouter {
  private success = true;

  private amountOut: bigint = 0n;

  private txHash: string | undefined;

  private revertReason: string | undefined;

  private slippagePercent = 0;

  private priceImpactPercent = 0;

  private history: SwapRecord[] = [];

  mockSwapResult(success: boolean, amountOut?: bigint, txHash?: string): void {
    this.success = success;
    if (amountOut !== undefined) this.amountOut = amountOut;
    this.txHash = txHash;
  }

  setSlippage(slippagePercent: number): void {
    this.slippagePercent = slippagePercent;
  }

  setPriceImpact(impactPercent: number): void {
    this.priceImpactPercent = impactPercent;
  }

  shouldRevert(revert: boolean, reason?: string): void {
    this.revertReason = revert ? reason ?? 'Swap reverted' : undefined;
  }

  private calculateAmountOut(amountIn: bigint): bigint {
    const slippageLoss = (amountIn * BigInt(Math.floor(this.slippagePercent * 100))) / 10000n;
    const impactLoss = (amountIn * BigInt(Math.floor(this.priceImpactPercent * 100))) / 10000n;
    const out = amountIn - slippageLoss - impactLoss;
    return out > 0n ? out : 0n;
  }

  async exactInputSingle(params: ExactInputSingleParams): Promise<ContractTransactionResponse> {
    if (this.revertReason) throw new Error(this.revertReason);
    if (!this.success) throw new Error('Swap failed');

    const amountOut = this.amountOut || this.calculateAmountOut(params.amountIn as bigint);
    this.history.push({ type: 'single', params, amountOut });
    return createMockTransactionResponse({ hash: this.txHash, success: true }) as unknown as ContractTransactionResponse;
  }

  async exactInput(params: ExactInputParams): Promise<ContractTransactionResponse> {
    if (this.revertReason) throw new Error(this.revertReason);
    if (!this.success) throw new Error('Swap failed');

    const amountIn = params.amountIn as bigint;
    const amountOut = this.amountOut || this.calculateAmountOut(amountIn);
    this.history.push({ type: 'multi', params, amountOut });
    return createMockTransactionResponse({ hash: this.txHash, success: true }) as unknown as ContractTransactionResponse;
  }

  async unwrapWETH9(_amountMinimum: BigNumberish, _recipient: string): Promise<ContractTransactionResponse> {
    if (this.revertReason) throw new Error(this.revertReason);
    return createMockTransactionResponse({ success: this.success, hash: this.txHash }) as unknown as ContractTransactionResponse;
  }

  getSwapHistory(): SwapRecord[] {
    return this.history;
  }
}

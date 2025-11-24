import { BigNumberish } from 'ethers';
import { Address, SwapResult } from '../../src/types';
import { createMockTransactionResponse, randomHash } from '../utils/testHelpers';

type SwapRecord = {
  type: 'single' | 'multi';
  params: any;
  amountOut: bigint;
  gasUsed?: bigint;
};

// Lightweight in-memory mock for SwapExecutor behaviour; does not talk to chain.
export class MockSwapExecutor {
  private success = true;

  private slippagePercent = 0;

  private priceImpactPercent = 0;

  private amountOutMock: bigint | undefined;

  private revertReason: string | undefined;

  private estimatedOutput: bigint | undefined;

  private txHash: string | undefined;

  private history: SwapRecord[] = [];

  private calls: Record<string, number> = {};

  mockSwapResult(success: boolean, amountOut?: bigint, txHash?: string): void {
    this.success = success;
    this.amountOutMock = amountOut;
    this.txHash = txHash;
  }

  setSlippage(percent: number): void {
    this.slippagePercent = percent;
  }

  setPriceImpact(percent: number): void {
    this.priceImpactPercent = percent;
  }

  shouldRevert(revert: boolean, reason?: string): void {
    this.revertReason = revert ? reason ?? 'Swap reverted' : undefined;
  }

  mockEstimatedOutput(output: bigint): void {
    this.estimatedOutput = output;
  }

  private calculateAmountOut(amountIn: bigint): bigint {
    const slippageLoss = (amountIn * BigInt(Math.floor(this.slippagePercent * 10_000))) / 10_000n;
    const impactLoss = (amountIn * BigInt(Math.floor(this.priceImpactPercent * 10_000))) / 10_000n;
    const out = amountIn - slippageLoss - impactLoss;
    return out > 0n ? out : 0n;
  }

  private record(method: 'single' | 'multi', params: any, amountOut: bigint): void {
    this.history.push({ type: method, params, amountOut });
    this.calls[method] = (this.calls[method] ?? 0) + 1;
  }

  async executeSingleHopSwap(params: any, gasParams?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }): Promise<SwapResult> {
    if (this.revertReason) throw new Error(this.revertReason);

    const amountIn = BigInt(params.amountIn ?? 0);
    const amountOut = this.amountOutMock ?? this.calculateAmountOut(amountIn);
    this.record('single', params, amountOut);

    if (!this.success) {
      return {
        success: false,
        amountIn,
        tokenIn: params.path?.[0],
        tokenOut: params.path?.[params.path?.length - 1],
        error: 'Swap failed',
      };
    }

    const tx = createMockTransactionResponse({ hash: this.txHash, success: true, gasUsed: gasParams?.maxFeePerGas });
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      amountIn,
      amountOut,
      tokenIn: params.path?.[0],
      tokenOut: params.path?.[params.path?.length - 1],
      gasUsed: receipt?.gasUsed ?? gasParams?.maxFeePerGas,
    };
  }

  async executeMultiHopSwap(
    path: Address[],
    fees: number[],
    amountIn: bigint,
    amountOutMin: bigint,
    gasParams: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint },
    recipient: Address,
  ): Promise<SwapResult> {
    if (this.revertReason) throw new Error(this.revertReason);

    const amountOut = this.amountOutMock ?? this.calculateAmountOut(amountIn);
    this.record('multi', { path, fees, amountIn, amountOutMin, recipient }, amountOut);

    if (!this.success) {
      return {
        success: false,
        amountIn,
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        error: 'Swap failed',
      };
    }

    const tx = createMockTransactionResponse({ hash: this.txHash, success: true, gasUsed: gasParams?.maxFeePerGas });
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      amountIn,
      amountOut,
      tokenIn: path[0],
      tokenOut: path[path.length - 1],
      gasUsed: receipt?.gasUsed ?? gasParams?.maxFeePerGas,
    };
  }

  async estimateSwapOutput(_tokenIn: Address, _tokenOut: Address, amountIn: bigint, _fee: number): Promise<bigint> {
    this.calls.estimateSwapOutput = (this.calls.estimateSwapOutput ?? 0) + 1;
    if (this.revertReason) throw new Error(this.revertReason);
    if (this.estimatedOutput !== undefined) return this.estimatedOutput;
    return this.amountOutMock ?? this.calculateAmountOut(amountIn);
  }

  getSwapHistory(): SwapRecord[] {
    return this.history;
  }

  getCallCount(method: string): number {
    return this.calls[method] ?? 0;
  }
}

export default MockSwapExecutor;

import { Address, CollateralStrategy, SwapResult } from '../../src/types';

export type CollateralCall = { seizeToken: Address; seizeAmount: bigint; liquidationResult: any };

export class MockCollateralManager {
  private swapResult: SwapResult | null = null;

  private balances: Map<Address, bigint> = new Map();

  private stats: Record<string, any> = { totalSwaps: 0, failedSwaps: 0 };

  private history: CollateralCall[] = [];

  mockSwapResult(result: SwapResult | null) {
    this.swapResult = result;
  }

  mockSwapFailure(error: string = 'Swap failed') {
    this.swapResult = { success: false, amountIn: 0n, tokenIn: '', tokenOut: '', error };
  }

  mockPriceImpactTooHigh() {
    this.swapResult = { success: false, amountIn: 0n, tokenIn: '', tokenOut: '', error: 'Price impact too high' };
  }

  mockBalance(token: Address, balance: bigint) {
    this.balances.set(token, balance);
  }

  mockStats(stats: Record<string, any>) {
    this.stats = stats;
  }

  async handleCollateral(
    seizeToken: Address,
    seizeAmount: bigint,
    liquidationResult: any,
    strategy: CollateralStrategy = CollateralStrategy.AUTO_SELL,
  ): Promise<SwapResult | null> {
    this.history.push({ seizeToken, seizeAmount, liquidationResult });

    if (strategy === CollateralStrategy.HOLD) {
      return null;
    }

    if (this.swapResult) {
      if (this.swapResult.success) this.stats.totalSwaps = (this.stats.totalSwaps ?? 0) + 1;
      else this.stats.failedSwaps = (this.stats.failedSwaps ?? 0) + 1;
      return this.swapResult;
    }

    return {
      success: true,
      txHash: '0xswap',
      amountIn: seizeAmount,
      amountOut: seizeAmount,
      tokenIn: seizeToken,
      tokenOut: seizeToken,
      priceImpact: 0.01,
    };
  }

  async getCollateralBalance(token: Address): Promise<bigint> {
    return this.balances.get(token) ?? 0n;
  }

  async getStats(): Promise<Record<string, any>> {
    return this.stats;
  }

  getHandleHistory() {
    return this.history;
  }
}

export default MockCollateralManager;

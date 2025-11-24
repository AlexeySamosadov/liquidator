import { parseUnits } from 'ethers';
import { GasEstimate, LiquidatablePosition, LiquidationMode, LiquidationResult } from '../../src/types';

export type StandardLiquidatorCall = {
  position: LiquidatablePosition;
  gasParams?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
};

export class MockStandardLiquidator {
  private executionResult: LiquidationResult | null = null;

  private failure: Error | null = null;

  private history: StandardLiquidatorCall[] = [];

  mockExecutionResult(result: LiquidationResult) {
    this.executionResult = result;
  }

  shouldFail(error: Error | string) {
    this.failure = typeof error === 'string' ? new Error(error) : error;
  }

  getExecutionHistory() {
    return this.history;
  }

  async executeLiquidation(
    position: LiquidatablePosition,
    gasParams?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
    _gasEstimate?: GasEstimate,
  ): Promise<LiquidationResult> {
    this.history.push({ position, gasParams });

    if (this.failure) {
      throw this.failure;
    }

    if (this.executionResult) {
      return this.executionResult;
    }

    return {
      success: true,
      mode: LiquidationMode.STANDARD,
      txHash: '0xstandard',
      profitUsd: position.estimatedProfitUsd ?? 50,
      gasUsd: 5,
      repayAmount: position.repayAmount,
      seizeAmount: position.repayAmount,
      repayToken: position.repayToken,
      seizeToken: position.seizeToken,
      gasUsed: 300000n,
      gasPriceGwei: Number(parseUnits('5', 'gwei')) / 1e9,
      liquidationBonus: 8,
      timestamp: Date.now(),
    };
  }
}

export default MockStandardLiquidator;

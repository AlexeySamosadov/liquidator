import { parseUnits } from 'ethers';
import { GasEstimate, LiquidatablePosition, LiquidationMode, LiquidationResult } from '../../src/types';

export type FlashLiquidatorCall = {
  position: LiquidatablePosition;
  gasParams?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
};

export class MockFlashLoanLiquidator {
  private executionResult: LiquidationResult | null = null;

  private failure: Error | null = null;

  private history: FlashLiquidatorCall[] = [];

  private poolMissing = false;

  private contractMissing = false;

  mockExecutionResult(result: LiquidationResult) {
    this.executionResult = result;
  }

  mockPoolNotFound() {
    this.poolMissing = true;
  }

  mockContractNotFound() {
    this.contractMissing = true;
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

    if (this.poolMissing) {
      return { success: false, error: 'No pool found', mode: LiquidationMode.FLASH_LOAN, timestamp: Date.now() };
    }

    if (this.contractMissing) {
      return { success: false, error: 'Flash loan contract not configured', mode: LiquidationMode.FLASH_LOAN, timestamp: Date.now() };
    }

    if (this.executionResult) {
      return this.executionResult;
    }

    return {
      success: true,
      mode: LiquidationMode.FLASH_LOAN,
      txHash: '0xflash',
      profitUsd: position.estimatedProfitUsd ?? 45,
      gasUsd: 6,
      flashLoanFee: 0.0009,
      repayAmount: position.repayAmount,
      seizeAmount: position.repayAmount,
      seizeToken: position.seizeToken,
      repayToken: position.repayToken,
      gasUsed: 350000n,
      gasPriceGwei: Number(parseUnits('6', 'gwei')) / 1e9,
      liquidationBonus: 8,
      timestamp: Date.now(),
    };
  }
}

export default MockFlashLoanLiquidator;

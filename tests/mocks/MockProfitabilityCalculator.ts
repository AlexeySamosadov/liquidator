import { GasEstimate, LiquidatablePosition, LiquidationMode, ProfitabilityAnalysis } from '../../src/types';

export type GasEstimateCall = {
  params: {
    position: LiquidatablePosition;
    mode: LiquidationMode;
    gasEstimate: GasEstimate;
    maxSlippage: number;
  };
};

export type ProfitabilityCall = {
  position: LiquidatablePosition;
  mode: LiquidationMode;
  gasEstimate: GasEstimate;
};

const defaultGasEstimate: GasEstimate = {
  estimatedGas: 300000n,
  gasPriceGwei: 5,
  estimatedCostUsd: 5,
  maxFeePerGas: 5_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
};

const buildDefaultAnalysis = (position: LiquidatablePosition): ProfitabilityAnalysis => ({
  grossProfitUsd: position.estimatedProfitUsd,
  gasCostUsd: 5,
  flashLoanFeeUsd: 0,
  netProfitUsd: position.estimatedProfitUsd - 5,
  profitMargin: (position.estimatedProfitUsd - 5) / Math.max(position.estimatedProfitUsd, 1),
  isProfitable: position.estimatedProfitUsd - 5 > 0,
  recommendedMode: LiquidationMode.STANDARD,
});

export class MockProfitabilityCalculator {
  private gasEstimate: GasEstimate | null = null;

  private profitability: ProfitabilityAnalysis | null = null;

  private gasCalls: GasEstimateCall[] = [];

  private profitabilityCalls: ProfitabilityCall[] = [];

  mockGasEstimate(estimate: GasEstimate) {
    this.gasEstimate = estimate;
  }

  mockProfitability(analysis: ProfitabilityAnalysis) {
    this.profitability = analysis;
  }

  getGasEstimateHistory() {
    return this.gasCalls;
  }

  getProfitabilityHistory() {
    return this.profitabilityCalls;
  }

  async estimateGas(params: GasEstimateCall['params']): Promise<GasEstimate> {
    this.gasCalls.push({ params });
    return this.gasEstimate ?? { ...defaultGasEstimate };
  }

  async estimateGasCostUsdForCandidate(position: LiquidatablePosition, mode: LiquidationMode): Promise<number> {
    const estimate = this.gasEstimate ?? defaultGasEstimate;
    this.gasCalls.push({
      params: {
        position,
        mode,
        gasEstimate: estimate,
        maxSlippage: 0,
      },
    });
    return estimate.estimatedCostUsd;
  }

  async analyzeProfitability(
    position: LiquidatablePosition,
    mode: LiquidationMode,
    gasEstimate: GasEstimate,
  ): Promise<ProfitabilityAnalysis> {
    this.profitabilityCalls.push({ position, mode, gasEstimate });
    if (this.profitability) return this.profitability;
    return { ...buildDefaultAnalysis(position), recommendedMode: mode };
  }
}

export default MockProfitabilityCalculator;

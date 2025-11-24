import { DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE, HIGH_GAS_PRICE } from '../utils/testData';

export type GasParams = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

export class MockTransactionBuilder {
  private params: GasParams = { maxFeePerGas: DEFAULT_MAX_FEE_PER_GAS, maxPriorityFeePerGas: DEFAULT_PRIORITY_FEE };

  private history: GasParams[] = [];

  mockGasParams(params: GasParams) {
    this.params = params;
  }

  mockHighGasParams() {
    this.params = { maxFeePerGas: HIGH_GAS_PRICE, maxPriorityFeePerGas: DEFAULT_PRIORITY_FEE };
  }

  getBuildHistory() {
    return this.history;
  }

  async buildGasParams(): Promise<GasParams> {
    this.history.push(this.params);
    return this.params;
  }
}

export default MockTransactionBuilder;

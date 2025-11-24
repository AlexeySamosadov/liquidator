import { JsonRpcProvider, FeeData } from 'ethers';
import { BotConfig } from '../../types';
import { logger } from '../../utils/logger';

class TransactionBuilder {
  constructor(private readonly config: BotConfig, private readonly provider: JsonRpcProvider) {}

  static calculateGasPrices(
    feeData: FeeData,
    config: BotConfig,
  ): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasPriceGwei: number } {
    const applyMultiplier = (value: bigint): bigint => {
      const multiplied = Number(value) * config.gasPriceMultiplier;
      return BigInt(Math.floor(multiplied));
    };

    const capWei = BigInt(Math.floor(config.maxGasPriceGwei * 1e9));

    const baseMaxFee = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const basePriority = feeData.maxPriorityFeePerGas ?? 0n;

    // Sanity check: ensure baseMaxFee is not zero
    if (baseMaxFee === 0n) {
      throw new Error('Fee data from provider is invalid or missing: baseMaxFee is 0');
    }

    let maxFeePerGas = applyMultiplier(baseMaxFee);
    let maxPriorityFeePerGas = applyMultiplier(basePriority);

    // Guard against config.gasPriceMultiplier turning small non-zero baseMaxFee into 0n
    if (maxFeePerGas === 0n) {
      throw new Error('Gas price multiplier resulted in zero maxFeePerGas');
    }

    if (maxFeePerGas > capWei) {
      throw new Error('Gas price too high');
    }

    if (maxPriorityFeePerGas > capWei) {
      maxPriorityFeePerGas = capWei;
    }

    const gasPriceGwei = Number(maxFeePerGas) / 1e9;

    logger.debug('Gas params calculated', {
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      multiplier: config.gasPriceMultiplier,
      capGwei: config.maxGasPriceGwei,
    });

    return { maxFeePerGas, maxPriorityFeePerGas, gasPriceGwei };
  }

  async buildGasParams(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const feeData = await this.provider.getFeeData();
    const { maxFeePerGas, maxPriorityFeePerGas } = TransactionBuilder.calculateGasPrices(feeData, this.config);
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  async estimateGasLimit(transaction: { to: string; data: string; value: bigint }): Promise<bigint> {
    try {
      const estimated = await this.provider.estimateGas(transaction);
      const buffered = (estimated * 110n) / 100n;
      logger.debug('Gas limit estimated with buffer', { estimated: estimated.toString(), buffered: buffered.toString() });
      return buffered;
    } catch (error) {
      logger.error('Failed to estimate gas limit', { error: (error as Error).message });
      throw error;
    }
  }
}

export default TransactionBuilder;

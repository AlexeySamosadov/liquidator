import { JsonRpcProvider } from 'ethers';
import { BotConfig, RiskCheckResult, RiskCheckType } from '../../types';
import { logger } from '../../utils/logger';

class GasPriceMonitor {
  constructor(private readonly provider: JsonRpcProvider, private readonly config: BotConfig) {}

  async checkGasPrice(): Promise<RiskCheckResult> {
    const feeData = await this.provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;

    if (!maxFeePerGas) {
      return {
        passed: false,
        checkType: RiskCheckType.GAS_PRICE_SPIKE,
        reason: 'Unable to fetch gas price',
      };
    }

    const gasPriceGwei = Number(maxFeePerGas) / 1e9;

    if (gasPriceGwei > this.config.maxGasPriceGwei) {
      logger.warn('Gas price exceeds configured maximum', { gasPriceGwei, max: this.config.maxGasPriceGwei });
      return {
        passed: false,
        checkType: RiskCheckType.GAS_PRICE_SPIKE,
        reason: 'Gas price exceeds maximum',
        details: { currentGwei: gasPriceGwei, maxGwei: this.config.maxGasPriceGwei },
      };
    }

    logger.debug('Gas price within acceptable range', { gasPriceGwei });
    return { passed: true, checkType: RiskCheckType.GAS_PRICE_SPIKE };
  }
}

export default GasPriceMonitor;

import { Contract, Wallet } from 'ethers';
import ProfitabilityCalculator from './ProfitabilityCalculator';
import { BotConfig, LiquidatablePosition, LiquidationMode } from '../../types';
import { logger } from '../../utils/logger';
import VenusContracts from '../../contracts';

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

class LiquidationStrategy {
  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly signer: Wallet,
    private readonly config: BotConfig,
    private readonly profitabilityCalculator: ProfitabilityCalculator,
  ) {}

  private async resolveUnderlying(repayToken: string): Promise<string | null> {
    const vToken = this.venusContracts.getVToken(repayToken);
    try {
      const underlying = await vToken.underlying();
      return underlying;
    } catch (error) {
      logger.debug('Underlying lookup reverted, treating as native asset (vBNB)', {
        repayToken,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async getWalletBalanceForRepay(position: LiquidatablePosition): Promise<bigint> {
    const underlying = await this.resolveUnderlying(position.repayToken);
    if (!underlying || underlying === '0x0000000000000000000000000000000000000000') {
      const provider = this.signer.provider;
      if (!provider) return 0n;
      return provider.getBalance(this.signer.address);
    }

    const erc20 = new Contract(underlying, ERC20_ABI, this.signer);
    return erc20.balanceOf(this.signer.address);
  }

  async selectStrategy(position: LiquidatablePosition): Promise<LiquidationMode> {
    if (!this.config.useFlashLoans) {
      logger.debug('Flash loans disabled; defaulting to standard');
      return LiquidationMode.STANDARD;
    }

    const balance = await this.getWalletBalanceForRepay(position);
    if (balance >= position.repayAmount) {
      const dummyParams = {
        position,
        gasEstimate: {
          estimatedGas: 0n,
          gasPriceGwei: 0,
          estimatedCostUsd: 0,
          maxFeePerGas: 0n,
          maxPriorityFeePerGas: 0n,
        },
        maxSlippage: this.config.slippageTolerance,
      };

      const standardGas = await this.profitabilityCalculator.estimateGas({
        ...dummyParams,
        mode: LiquidationMode.STANDARD,
      });
      const flashGas = await this.profitabilityCalculator.estimateGas({
        ...dummyParams,
        mode: LiquidationMode.FLASH_LOAN,
      });

      const standardProfit = await this.profitabilityCalculator.analyzeProfitability(
        position,
        LiquidationMode.STANDARD,
        standardGas,
      );
      const flashProfit = await this.profitabilityCalculator.analyzeProfitability(
        position,
        LiquidationMode.FLASH_LOAN,
        flashGas,
      );

      logger.debug('Strategy comparison', { standardProfit, flashProfit });
      return flashProfit.netProfitUsd > standardProfit.netProfitUsd
        ? LiquidationMode.FLASH_LOAN
        : LiquidationMode.STANDARD;
    }

    if (this.config.flashLiquidatorContract) {
      logger.debug('Using flash loan due to insufficient wallet balance');
      return LiquidationMode.FLASH_LOAN;
    }

    throw new Error('Insufficient balance and flash loans not available');
  }

  async validateStrategy(position: LiquidatablePosition, mode: LiquidationMode): Promise<boolean> {
    const balance = await this.getWalletBalanceForRepay(position);

    if (mode === LiquidationMode.STANDARD) {
      const enoughBalance = balance >= position.repayAmount;
      const profitable = position.estimatedProfitUsd >= this.config.minProfitUsd;
      logger.debug('Standard strategy validation', { enoughBalance, profitable });
      return enoughBalance && profitable;
    }

    const flashConfigured = Boolean(this.config.flashLiquidatorContract);
    const profitable = position.estimatedProfitUsd >= this.config.minProfitUsd;
    logger.debug('Flash strategy validation', { flashConfigured, profitable });
    return flashConfigured && profitable;
  }
}

export default LiquidationStrategy;

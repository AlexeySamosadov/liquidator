import { Contract, JsonRpcProvider } from 'ethers';
import {
  BotConfig,
  GasEstimate,
  LiquidatablePosition,
  LiquidationExecutionParams,
  LiquidationMode,
  ProfitabilityAnalysis,
  VenusPosition,
} from '../../types';
import { VTOKEN_ABI } from '../../contracts/abis/VToken.abi';
import { logger } from '../../utils/logger';
import TransactionBuilder from './TransactionBuilder';
import PriceService from '../pricing/PriceService';

class ProfitabilityCalculator {
  constructor(
    private readonly config: BotConfig,
    private readonly provider: JsonRpcProvider,
    private readonly priceService: PriceService,
  ) {}

  async estimateGas(params: LiquidationExecutionParams): Promise<GasEstimate> {
    const baseGas = params.mode === LiquidationMode.FLASH_LOAN ? 300000n : 220000n;
    let estimatedGas = baseGas + (params.mode === LiquidationMode.FLASH_LOAN ? 50000n : 0n);

    try {
      const vToken = new Contract(params.position.repayToken, VTOKEN_ABI, this.provider);
      const gasEstimation = await vToken.liquidateBorrow.estimateGas(
        params.position.borrower,
        params.position.repayAmount,
        params.position.seizeToken,
      );
      estimatedGas = gasEstimation + (params.mode === LiquidationMode.FLASH_LOAN ? 50000n : 0n);
    } catch (error) {
      logger.warn('Gas estimation fallback used for liquidation', { error: (error as Error).message });
    }

    const feeData = await this.provider.getFeeData();
    const { maxFeePerGas, maxPriorityFeePerGas, gasPriceGwei } = TransactionBuilder.calculateGasPrices(
      feeData,
      this.config,
    );

    const estimatedCostWei = estimatedGas * maxFeePerGas;
    const bnbPriceUsd = await this.priceService.getBnbPriceUsd();

    // Check for invalid BNB price
    if (!Number.isFinite(bnbPriceUsd) || bnbPriceUsd <= 0) {
      logger.error('Invalid BNB price detected during gas estimation', { bnbPriceUsd });
      throw new Error('Invalid BNB price for gas cost estimation');
    }

    let estimatedCostBnb: number;
    try {
      estimatedCostBnb = this.toNumberWithScale(estimatedCostWei, 10n ** 18n, 'gasCostBnb');
    } catch (error) {
      logger.error('Failed to normalize gas cost', {
        error: (error as Error).message,
        estimatedGas: estimatedGas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
      });
      throw error;
    }

    if (!Number.isFinite(estimatedCostBnb)) {
      logger.error('Non-finite gas cost detected', {
        estimatedCostBnb,
        estimatedGas: estimatedGas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
      });
      throw new Error('Gas cost normalization produced a non-finite value');
    }

    const estimatedCostUsd = estimatedCostBnb * bnbPriceUsd;
    if (!Number.isFinite(estimatedCostUsd)) {
      logger.error('Non-finite USD gas cost detected', { estimatedCostUsd, bnbPriceUsd, estimatedCostBnb });
      throw new Error('Gas cost USD normalization produced a non-finite value');
    }

    const gasEstimate: GasEstimate = {
      estimatedGas,
      gasPriceGwei,
      estimatedCostUsd,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };

    logger.debug('Gas estimate calculated', { ...gasEstimate, mode: params.mode });
    return gasEstimate;
  }

  /**
   * Lightweight gas cost estimator for ranking candidates before full execution planning.
   * Uses the same fee data and pricing inputs as runtime execution but avoids contract calls.
   */
  async estimateGasCostUsdForCandidate(
    _position: LiquidatablePosition | VenusPosition,
    mode: LiquidationMode = LiquidationMode.STANDARD,
  ): Promise<number> {
    const baseGas = mode === LiquidationMode.FLASH_LOAN ? 300000n : 220000n;
    const bufferGas = mode === LiquidationMode.FLASH_LOAN ? 50000n : 30000n;
    const estimatedGas = baseGas + bufferGas;

    try {
      const feeData = await this.provider.getFeeData();
      const { maxFeePerGas } = TransactionBuilder.calculateGasPrices(feeData, this.config);
      const estimatedCostWei = estimatedGas * maxFeePerGas;
      const bnbPriceUsd = await this.priceService.getBnbPriceUsd();

      // Check for invalid BNB price
      if (!Number.isFinite(bnbPriceUsd) || bnbPriceUsd <= 0) {
        logger.warn('Invalid BNB price detected during candidate gas estimation', { bnbPriceUsd });
        throw new Error('Invalid BNB price for candidate gas cost estimation');
      }

      const estimatedCostBnb = this.toNumberWithScale(estimatedCostWei, 10n ** 18n, 'candidateGasCostBnb');
      const estimatedCostUsd = estimatedCostBnb * bnbPriceUsd;

      if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) {
        throw new Error('Non-finite or negative candidate gas cost');
      }

      return estimatedCostUsd;
    } catch (error) {
      logger.warn('Falling back to default candidate gas cost', { error: (error as Error).message });
      return 0.1;
    }
  }

  calculateFlashLoanFee(borrowAmount: bigint, tokenDecimals: number, tokenPriceUsd = 1): number {
    const scale = 10n ** BigInt(tokenDecimals);
    const priceScale = 100_000_000n; // 1e8 precision for USD calculations
    if (!Number.isFinite(tokenPriceUsd)) {
      throw new Error('Invalid token price provided for flash loan fee calculation');
    }

    const amountScaled = (borrowAmount * priceScale) / scale; // token amount scaled to priceScale
    const priceScaledNumber = Math.round(tokenPriceUsd * Number(priceScale));
    if (!Number.isFinite(priceScaledNumber)) {
      throw new Error('Invalid scaled token price for flash loan fee calculation');
    }
    const priceScaled = BigInt(priceScaledNumber);

    const amountUsdScaled = (amountScaled * priceScaled) / priceScale; // USD value scaled to priceScale
    const feeScaled = (amountUsdScaled * BigInt(this.config.flashLoanFeeBps)) / 10_000n;

    return Number(feeScaled) / Number(priceScale);
  }

  async analyzeProfitability(
    position: LiquidatablePosition,
    mode: LiquidationMode,
    gasEstimate: GasEstimate,
  ): Promise<ProfitabilityAnalysis> {
    try {
      const grossProfitUsd = position.estimatedProfitUsd;
      const gasCostUsd = gasEstimate.estimatedCostUsd;

      // Validate BNB price for flash loan fee calculation
      const bnbPriceUsd = await this.priceService.getBnbPriceUsd();
      if (!Number.isFinite(bnbPriceUsd) || bnbPriceUsd <= 0) {
        logger.error('Invalid BNB price detected during profitability analysis', { bnbPriceUsd });
        throw new Error('Invalid BNB price for profitability analysis');
      }

      // Validate repay token price for flash loan fee calculation if needed
      const repayTokenPriceUsd = position.repayTokenPriceUsd ?? 1;
      if (mode === LiquidationMode.FLASH_LOAN && (!Number.isFinite(repayTokenPriceUsd) || repayTokenPriceUsd <= 0)) {
        logger.warn('Invalid repay token price detected, using fallback for flash loan fee', {
          repayTokenPriceUsd,
          borrower: position.borrower,
          repayToken: position.repayToken,
        });
      }

      const flashLoanFeeUsd = mode === LiquidationMode.FLASH_LOAN
        ? this.calculateFlashLoanFee(
          position.repayAmount,
          position.repayTokenDecimals ?? 18,
          repayTokenPriceUsd,
        )
        : 0;

      if (mode === LiquidationMode.FLASH_LOAN
        && (position.repayTokenDecimals === undefined || position.repayTokenPriceUsd === undefined)) {
        logger.debug('Flash loan fee using fallback token metadata', {
          borrower: position.borrower,
          repayToken: position.repayToken,
          decimals: position.repayTokenDecimals,
          priceUsd: position.repayTokenPriceUsd,
        });
      }

      const netProfitUsd = grossProfitUsd - gasCostUsd - flashLoanFeeUsd;
      const repayBaseUsd = position.debtValueUsd / 2;

      // Validate debt value for profit margin calculation
      if (!Number.isFinite(position.debtValueUsd) || position.debtValueUsd <= 0) {
        logger.error('Invalid debt value detected during profitability analysis', {
          debtValueUsd: position.debtValueUsd,
          borrower: position.borrower
        });
        throw new Error('Invalid debt value for profitability analysis');
      }

      const profitMargin = repayBaseUsd > 0 ? netProfitUsd / repayBaseUsd : 0;
      const isProfitable = netProfitUsd >= this.config.minProfitUsd;

      const analysis: ProfitabilityAnalysis = {
        grossProfitUsd,
        gasCostUsd,
        flashLoanFeeUsd,
        netProfitUsd,
        profitMargin,
        isProfitable,
        recommendedMode: mode,
      };

      logger.debug('Profitability analysis', { analysis, mode, borrower: position.borrower });
      return analysis;
    } catch (error) {
      logger.error('Failed to analyze profitability', { error: (error as Error).message, borrower: position.borrower });
      throw error;
    }
  }

  private toNumberWithScale(value: bigint, scale: bigint, label: string): number {
    if (scale === 0n) throw new Error('Scale cannot be zero');
    const integerPart = value / scale;
    const fractionalPart = value % scale;
    const fractionalScaled = (fractionalPart * 1_000_000n) / scale;

    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    if (integerPart > maxSafe || integerPart < -maxSafe) {
      throw new Error(`Value ${label} exceeds safe JS number range after scaling`);
    }

    const result = Number(integerPart) + Number(fractionalScaled) / 1_000_000;

    if (!Number.isFinite(result)) {
      throw new Error(`Value ${label} is not finite after normalization`);
    }

    if (Math.abs(result) > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Value ${label} exceeds safe JS number range`);
    }

    return result;
  }
}

export default ProfitabilityCalculator;

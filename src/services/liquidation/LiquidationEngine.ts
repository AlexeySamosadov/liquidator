import { Contract, JsonRpcProvider, Wallet, formatUnits } from 'ethers';
import VenusContracts from '../../contracts';
import {
  BotConfig,
  CollateralSwapConfig,
  LiquidatablePosition,
  LiquidationMode,
  LiquidationResult,
} from '../../types';
import { logger } from '../../utils/logger';
import ProfitabilityCalculator from './ProfitabilityCalculator';
import TransactionBuilder from './TransactionBuilder';
import StandardLiquidator from './StandardLiquidator';
import FlashLoanLiquidator from './FlashLoanLiquidator';
import LiquidationStrategy from './LiquidationStrategy';
import { RiskManager } from '../risk';
import { CollateralManager, PriceImpactChecker, RouteOptimizer, SwapExecutor } from '../dex';
import { PANCAKE_V3_ROUTER_ABI } from '../../contracts/abis/PancakeSwapV3Router.abi';
import { COMMON_TOKENS, DEFAULT_TOKEN_CONFIGS } from '../../config/tokens';
import PriceService from '../pricing/PriceService';

class LiquidationEngine {
  private profitabilityCalculator!: ProfitabilityCalculator;

  private transactionBuilder!: TransactionBuilder;

  private standardLiquidator!: StandardLiquidator;

  private flashLoanLiquidator!: FlashLoanLiquidator;

  private liquidationStrategy!: LiquidationStrategy;

  private collateralManager!: CollateralManager;

  private riskManager!: RiskManager;

  private liquidationBonusPercent = 0;

  private stats = {
    totalAttempts: 0,
    dryRunAttempts: 0,
    successCount: 0,
    failureCount: 0,
    totalProfitUsd: 0,
    totalGasCostUsd: 0,
    totalRealizedUsd: 0,
  };

  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly signer: Wallet,
    private readonly provider: JsonRpcProvider,
    private readonly config: BotConfig,
    private readonly priceService: PriceService,
  ) {}

  async initialize(): Promise<void> {
    const incentiveMantissa = await this.venusContracts.getComptroller().liquidationIncentiveMantissa();
    this.liquidationBonusPercent = (Number(incentiveMantissa) / 1e18 - 1) * 100;

    this.profitabilityCalculator = new ProfitabilityCalculator(this.config, this.provider, this.priceService);
    this.transactionBuilder = new TransactionBuilder(this.config, this.provider);
    this.standardLiquidator = new StandardLiquidator(
      this.venusContracts,
      this.signer,
      this.liquidationBonusPercent,
    );
    this.flashLoanLiquidator = new FlashLoanLiquidator(
      this.provider,
      this.config,
      this.liquidationBonusPercent,
      this.signer,
    );
    this.liquidationStrategy = new LiquidationStrategy(
      this.venusContracts,
      this.signer,
      this.config,
      this.profitabilityCalculator,
    );

    const router = new Contract(this.config.dex.pancakeswapRouter, PANCAKE_V3_ROUTER_ABI, this.signer);
    const swapExecutor = new SwapExecutor(router as Contract, this.signer, this.config);
    const priceImpactChecker = new PriceImpactChecker(this.config, this.priceService);
    const routeOptimizer = new RouteOptimizer(
      this.provider,
      this.config.dex.pancakeswapV3Factory || '',
      this.config.dex.pancakeswapRouter,
      swapExecutor,
    );

    const collateralSwapConfig: CollateralSwapConfig = {
      strategy: this.config.collateralStrategy,
      targetStablecoins: [this.config.preferredStablecoin || COMMON_TOKENS.USDT],
      tokenConfigs: DEFAULT_TOKEN_CONFIGS,
      maxSlippage: this.config.slippageTolerance,
      maxPriceImpact: this.config.maxPriceImpact,
      minSwapAmountUsd: this.config.minSwapAmountUsd,
    };
    this.collateralManager = new CollateralManager(
      swapExecutor,
      priceImpactChecker,
      routeOptimizer,
      this.config,
      this.signer,
      collateralSwapConfig,
    );

    this.riskManager = new RiskManager(this.config, this.signer, this.provider, this.venusContracts);
    await this.riskManager.initialize();
    logger.info('Risk manager initialized');

    logger.info('Liquidation engine initialized', {
      useFlashLoans: this.config.useFlashLoans,
      minProfitUsd: this.config.minProfitUsd,
      maxGasPriceGwei: this.config.maxGasPriceGwei,
    });
  }

  async executeLiquidation(position: LiquidatablePosition): Promise<LiquidationResult> {
    logger.info('Attempting liquidation', { borrower: position.borrower, profit: position.estimatedProfitUsd });

    try {
      this.stats.totalAttempts += 1;

      const mode = await this.liquidationStrategy.selectStrategy(position);
      const valid = await this.liquidationStrategy.validateStrategy(position, mode);
      if (!valid) {
        return { success: false, error: 'Strategy validation failed', mode, timestamp: Date.now() };
      }

      const riskValidation = await this.riskManager.validateLiquidation(position, mode);
      if (!riskValidation.canProceed) {
        const reasons = riskValidation.failedChecks.map((c) => c.reason).filter(Boolean).join(', ');
        logger.warn('Risk validation failed', { borrower: position.borrower, reasons });
        const result: LiquidationResult = { success: false, error: `Risk checks failed: ${reasons}`, mode, timestamp: Date.now() };
        this.riskManager.recordLiquidationResult(result);
        return result;
      }

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
        mode,
      };

      const gasEstimate = await this.profitabilityCalculator.estimateGas(dummyParams);
      const profitability = await this.profitabilityCalculator.analyzeProfitability(position, mode, gasEstimate);
      if (!profitability.isProfitable) {
        return {
          success: false,
          error: 'Liquidation not profitable after gas costs',
          mode,
          timestamp: Date.now(),
        };
      }

      const gasParams = await this.transactionBuilder.buildGasParams();
      let result: LiquidationResult;

      if (this.config.dryRun) {
        this.stats.dryRunAttempts += 1;
        result = {
          success: true,
          mode,
          timestamp: Date.now(),
          profitUsd: position.estimatedProfitUsd,
          details: { dryRun: true },
        };
        logger.info('[DRY RUN] Validation passed; skipping execution', { borrower: position.borrower, mode });
      } else if (mode === LiquidationMode.STANDARD) {
        result = await this.standardLiquidator.executeLiquidation(position, gasParams);
      } else {
        result = await this.flashLoanLiquidator.executeLiquidation(position, gasParams);
      }

      if (result.success) {
        this.stats.successCount += 1;
        if (result.profitUsd) this.stats.totalProfitUsd += result.profitUsd;
        if (profitability.gasCostUsd) this.stats.totalGasCostUsd += profitability.gasCostUsd;

        if (result.seizeToken && result.seizeAmount) {
          try {
            const swapResult = await this.collateralManager.handleCollateral(result.seizeToken, result.seizeAmount, result);
            logger.info('Collateral swap completed', { swapPerformed: Boolean(swapResult), txHash: swapResult?.txHash });

            if (swapResult?.success && swapResult.amountOut) {
              // Swap realizes seized collateral; avoid adding to totalProfitUsd to prevent double counting.
              this.stats.totalRealizedUsd += Number.parseFloat(formatUnits(swapResult.amountOut, 18));
            }
          } catch (swapError) {
            logger.warn('Collateral swap failed but liquidation succeeded', { error: (swapError as Error).message });
          }
        }
      } else {
        this.stats.failureCount += 1;
      }

      this.riskManager.recordLiquidationResult(result);
      logger.info('Liquidation attempt finished', { success: result.success, mode });
      return result;
    } catch (error) {
      this.stats.failureCount += 1;
      logger.error('Liquidation execution failed', { error: (error as Error).message, borrower: position.borrower });
      const result: LiquidationResult = { success: false, error: (error as Error).message, timestamp: Date.now() };
      this.riskManager.recordLiquidationResult(result);
      return result;
    }
  }

  async canExecute(position: LiquidatablePosition): Promise<boolean> {
    const sizeOk = position.debtValueUsd >= this.config.minPositionSizeUsd
      && position.debtValueUsd <= this.config.maxPositionSizeUsd;
    const profitOk = position.estimatedProfitUsd >= this.config.minProfitUsd;

    if (!sizeOk || !profitOk) {
      return false;
    }

    try {
      const mode = await this.liquidationStrategy.selectStrategy(position);
      const valid = await this.liquidationStrategy.validateStrategy(position, mode);
      return valid;
    } catch (error) {
      logger.warn('canExecute check failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Aggregate runtime stats. totalProfitUsd reflects the liquidation bonus and repayments before swaps,
   * while totalRealizedUsd measures stablecoin realized from post-liquidation swaps.
   */
  getStats(): {
    totalAttempts: number;
    dryRunAttempts: number;
    successCount: number;
    failureCount: number;
    totalProfitUsd: number;
    totalGasCostUsd: number;
    totalRealizedUsd: number;
  } {
    return this.stats;
  }

  getDailyStats() {
    return this.riskManager.getDailyStats();
  }

  getEmergencyStopState() {
    return this.riskManager.getEmergencyStopState();
  }
}

export default LiquidationEngine;

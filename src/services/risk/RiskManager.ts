import { JsonRpcProvider, Wallet } from 'ethers';
import {
  BotConfig,
  DailyStats,
  EmergencyStopState,
  LiquidatablePosition,
  LiquidationMode,
  LiquidationResult,
  RiskCheckResult,
  RiskCheckType,
  RiskValidationResult,
} from '../../types';
import VenusContracts from '../../contracts/VenusContracts';
import { logger } from '../../utils/logger';
import TokenValidator from './TokenValidator';
import BalanceChecker from './BalanceChecker';
import GasPriceMonitor from './GasPriceMonitor';
import DailyLossTracker from './DailyLossTracker';
import EmergencyStop from './EmergencyStop';
import HealthFactorValidator from './HealthFactorValidator';

class RiskManager {
  private readonly tokenValidator: TokenValidator;

  private readonly balanceChecker: BalanceChecker;

  private readonly gasPriceMonitor: GasPriceMonitor;

  private readonly dailyLossTracker: DailyLossTracker;

  private readonly emergencyStop: EmergencyStop;

  private readonly healthFactorValidator: HealthFactorValidator;

  constructor(
    private readonly config: BotConfig,
    signer: Wallet,
    provider: JsonRpcProvider,
    venusContracts: VenusContracts,
  ) {
    this.tokenValidator = new TokenValidator(config);
    this.balanceChecker = new BalanceChecker(signer, venusContracts);
    this.gasPriceMonitor = new GasPriceMonitor(provider, config);
    this.dailyLossTracker = new DailyLossTracker(config);
    this.emergencyStop = new EmergencyStop(config);
    this.healthFactorValidator = new HealthFactorValidator(venusContracts);
  }

  async initialize(): Promise<void> {
    await this.dailyLossTracker.initialize();
    await this.emergencyStop.initialize();
    logger.info('RiskManager initialized');
  }

  async validateLiquidation(position: LiquidatablePosition, mode: LiquidationMode): Promise<RiskValidationResult> {
    const failedChecks: RiskCheckResult[] = [];

    const stop = await this.emergencyStop.checkEmergencyStop();
    if (!stop.passed) {
      failedChecks.push(stop);
      return { canProceed: false, failedChecks, warnings: [] };
    }

    const dailyLoss = this.dailyLossTracker.checkDailyLossLimit();
    if (!dailyLoss.passed) {
      failedChecks.push(dailyLoss);
      await this.emergencyStop.activate('Daily loss limit exceeded');
      return { canProceed: false, failedChecks, warnings: [] };
    }

    const gas = await this.gasPriceMonitor.checkGasPrice();
    if (!gas.passed) failedChecks.push(gas);

    const tokenResults = this.tokenValidator.validateTokens(position.repayToken, position.seizeToken);
    failedChecks.push(...tokenResults);

    const balance = await this.balanceChecker.checkBalance(position, mode);
    if (!balance.passed) failedChecks.push(balance);

    const healthFactorResult = await this.healthFactorValidator.validateHealthFactor(position);
    if (!healthFactorResult.passed) failedChecks.push(healthFactorResult);

    if (position.debtValueUsd > this.config.maxPositionSizeUsd) {
      failedChecks.push({
        passed: false,
        checkType: RiskCheckType.POSITION_SIZE_EXCEEDED,
        reason: 'Position size exceeds maximum',
        details: { debtValueUsd: position.debtValueUsd, maxPositionSizeUsd: this.config.maxPositionSizeUsd },
      });
    }

    if (position.debtValueUsd < this.config.minPositionSizeUsd) {
      failedChecks.push({
        passed: false,
        checkType: RiskCheckType.POSITION_SIZE_EXCEEDED,
        reason: 'Position size is below the minimum allowed size',
        details: { debtValueUsd: position.debtValueUsd, minPositionSizeUsd: this.config.minPositionSizeUsd },
      });
    }

    const canProceed = failedChecks.length === 0;

    return {
      canProceed,
      failedChecks,
      warnings: [],
    };
  }

  recordLiquidationResult(result: LiquidationResult): void {
    const netProfit = (result.profitUsd ?? 0) - (result.gasUsd ?? 0);
    this.dailyLossTracker.recordAttempt(result.success, netProfit);

    const lossCheck = this.dailyLossTracker.checkDailyLossLimit();
    if (!lossCheck.passed) {
      // Daily-loss-triggered emergency stop activation is centralized in validateLiquidation
      // to avoid duplicate activation paths.
      logger.warn('Daily loss limit exceeded; emergency stop activation handled in validateLiquidation', {
        lossCheck,
        emergencyStopState: this.emergencyStop.getState(),
      });
    }
  }

  getDailyStats(): DailyStats {
    return this.dailyLossTracker.getStats();
  }

  getEmergencyStopState(): EmergencyStopState {
    return this.emergencyStop.getState();
  }

  async activateEmergencyStop(reason: string): Promise<void> {
    await this.emergencyStop.activate(reason, 'manual');
  }

  async deactivateEmergencyStop(): Promise<void> {
    await this.emergencyStop.deactivate();
  }
}

export default RiskManager;

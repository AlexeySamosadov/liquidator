import {
  DailyStats,
  EmergencyStopState,
  LiquidatablePosition,
  LiquidationMode,
  LiquidationResult,
  RiskCheckType,
  RiskValidationResult,
} from '../../src/types';

export class MockRiskManager {
  private validation: RiskValidationResult = { canProceed: true, failedChecks: [], warnings: [] };

  private dailyStats: DailyStats = {
    date: new Date().toISOString().slice(0, 10),
    totalAttempts: 0,
    successCount: 0,
    failureCount: 0,
    totalProfitUsd: 0,
    totalLossUsd: 0,
    netProfitUsd: 0,
  };

  private emergency: EmergencyStopState = { isActive: false };

  private validationHistory: { position: LiquidatablePosition; mode: LiquidationMode }[] = [];

  private recordHistory: LiquidationResult[] = [];

  private dailyStatsHistory: DailyStats[] = [];

  private emergencyHistory: EmergencyStopState[] = [];

  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  mockValidationResult(result: RiskValidationResult) {
    this.validation = result;
  }

  mockFailedCheck(checkType: RiskCheckType, reason?: string) {
    this.validation = {
      canProceed: false,
      failedChecks: [{ passed: false, checkType, reason }],
      warnings: [],
    };
  }

  mockDailyStats(stats: DailyStats) {
    this.dailyStats = stats;
  }

  mockEmergencyStop(state: EmergencyStopState) {
    this.emergency = state;
  }

  mockEmergencyStopActive(reason: string = 'Emergency stop active') {
    this.emergency = { isActive: true, reason, activatedAt: Date.now() };
    this.validation = {
      canProceed: false,
      failedChecks: [{ passed: false, checkType: RiskCheckType.EMERGENCY_STOP, reason }],
      warnings: [],
    };
  }

  mockDailyLossExceeded() {
    this.validation = {
      canProceed: false,
      failedChecks: [{ passed: false, checkType: RiskCheckType.DAILY_LOSS_LIMIT, reason: 'Daily loss exceeded' }],
      warnings: [],
    };
  }

  mockGasPriceSpike() {
    this.validation = {
      canProceed: false,
      failedChecks: [{ passed: false, checkType: RiskCheckType.GAS_PRICE_SPIKE, reason: 'Gas price too high' }],
      warnings: [],
    };
  }

  mockTokenBlacklisted() {
    this.validation = {
      canProceed: false,
      failedChecks: [{ passed: false, checkType: RiskCheckType.TOKEN_BLACKLIST, reason: 'Token blacklisted' }],
      warnings: [],
    };
  }

  mockInsufficientBalance() {
    this.validation = {
      canProceed: false,
      failedChecks: [{ passed: false, checkType: RiskCheckType.INSUFFICIENT_BALANCE, reason: 'Insufficient balance' }],
      warnings: [],
    };
  }

  async validateLiquidation(position: LiquidatablePosition, mode: LiquidationMode): Promise<RiskValidationResult> {
    this.validationHistory.push({ position, mode });
    return this.validation;
  }

  recordLiquidationResult(result: LiquidationResult): void {
    this.recordHistory.push(result);
  }

  getRecordHistory() {
    return this.recordHistory;
  }

  async getDailyStats(): Promise<DailyStats> {
    this.dailyStatsHistory.push(this.dailyStats);
    return this.dailyStats;
  }

  async getEmergencyStopState(): Promise<EmergencyStopState> {
    this.emergencyHistory.push(this.emergency);
    return this.emergency;
  }

  async activateEmergencyStop(reason: string): Promise<void> {
    this.emergency = { isActive: true, reason, activatedAt: Date.now(), activatedBy: 'test' };
  }

  async deactivateEmergencyStop(): Promise<void> {
    this.emergency = { isActive: false };
  }

  getValidationHistory() {
    return this.validationHistory;
  }

  getDailyStatsHistory() {
    return this.dailyStatsHistory;
  }

  getEmergencyHistory() {
    return this.emergencyHistory;
  }
}

export default MockRiskManager;

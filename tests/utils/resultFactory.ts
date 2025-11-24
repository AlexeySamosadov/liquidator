import { parseUnits } from 'ethers';
import {
  DailyStats,
  EmergencyStopState,
  GasEstimate,
  LiquidatablePosition,
  LiquidationMode,
  LiquidationResult,
  ProfitabilityAnalysis,
  RiskCheckResult,
  RiskCheckType,
  RiskValidationResult,
  SwapResult,
} from '../../src/types';
import { DEFAULT_MAX_FEE_PER_GAS, DEFAULT_PRIORITY_FEE, TEST_TOKENS, TEST_TX_HASH } from './testData';

export const createLiquidationResult = (overrides: Partial<LiquidationResult> = {}): LiquidationResult => ({
  success: true,
  mode: LiquidationMode.STANDARD,
  txHash: TEST_TX_HASH,
  profitUsd: 50,
  gasUsd: 5,
  repayAmount: parseUnits('100', 18),
  seizeAmount: parseUnits('120', 18),
  repayToken: TEST_TOKENS.USDT,
  seizeToken: TEST_TOKENS.WBNB,
  gasUsed: 300000n,
  gasPriceGwei: 5,
  liquidationBonus: 8,
  timestamp: Date.now(),
  ...overrides,
});

export const createSuccessfulLiquidationResult = (overrides: Partial<LiquidationResult> = {}): LiquidationResult =>
  createLiquidationResult({ success: true, ...overrides });

export const createFailedLiquidationResult = (error: string, overrides: Partial<LiquidationResult> = {}): LiquidationResult =>
  createLiquidationResult({ success: false, error, ...overrides });

export const createSwapResult = (overrides: Partial<SwapResult> = {}): SwapResult => ({
  success: true,
  txHash: TEST_TX_HASH,
  amountIn: parseUnits('1', 18),
  amountOut: parseUnits('300', 18),
  tokenIn: TEST_TOKENS.WBNB,
  tokenOut: TEST_TOKENS.USDT,
  priceImpact: 0.01,
  ...overrides,
});

export const createRiskValidationResult = (overrides: Partial<RiskValidationResult> = {}): RiskValidationResult => ({
  canProceed: true,
  failedChecks: [],
  warnings: [],
  ...overrides,
});

export const createFailedRiskValidation = (
  checkType: RiskCheckType,
  reason: string,
  overrides: Partial<RiskValidationResult> = {},
): RiskValidationResult => ({
  canProceed: false,
  failedChecks: [createRiskCheck(checkType, reason)],
  warnings: [],
  ...overrides,
});

export const createRiskCheck = (checkType: RiskCheckType, reason: string): RiskCheckResult => ({
  passed: false,
  checkType,
  reason,
});

export const createGasEstimate = (overrides: Partial<GasEstimate> = {}): GasEstimate => ({
  estimatedGas: 300000n,
  gasPriceGwei: 5,
  estimatedCostUsd: 5,
  maxFeePerGas: DEFAULT_MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: DEFAULT_PRIORITY_FEE,
  ...overrides,
});

export const createProfitabilityAnalysis = (
  overrides: Partial<ProfitabilityAnalysis> = {},
): ProfitabilityAnalysis => ({
  grossProfitUsd: 50,
  gasCostUsd: 5,
  flashLoanFeeUsd: 0,
  netProfitUsd: 45,
  profitMargin: 0.9,
  isProfitable: true,
  recommendedMode: overrides.recommendedMode ?? LiquidationMode.STANDARD,
  ...overrides,
});

export const createDailyStats = (overrides: Partial<DailyStats> = {}): DailyStats => ({
  date: new Date().toISOString().slice(0, 10),
  totalAttempts: 0,
  successCount: 0,
  failureCount: 0,
  totalProfitUsd: 0,
  totalLossUsd: 0,
  netProfitUsd: 0,
  ...overrides,
});

export const createEmergencyStopState = (overrides: Partial<EmergencyStopState> = {}): EmergencyStopState => ({
  isActive: false,
  reason: undefined,
  activatedAt: undefined,
  activatedBy: undefined,
  ...overrides,
});

export const createPositionWithProfit = (position: LiquidatablePosition, profitUsd: number): LiquidatablePosition => ({
  ...position,
  estimatedProfitUsd: profitUsd,
});

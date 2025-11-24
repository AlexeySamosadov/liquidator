import { expect } from '@jest/globals';
import {
  AccountLiquidity,
  GasEstimate,
  LiquidatablePosition,
  LiquidationResult,
  MonitoringStats,
  PositionTrackerStats,
  PriceImpactCheck,
  ProfitabilityAnalysis,
  RiskCheckType,
  RiskValidationResult,
  SwapResult,
  VenusPosition,
} from '../../src/types';
import MockSwapExecutor from '../mocks/MockSwapExecutor';

export const expectLiquidationSuccess = (result: LiquidationResult, expectedProfit?: number): void => {
  expect(result.success).toBe(true);
  expect(result.txHash).toBeDefined();
  expect(result.profitUsd ?? 0).toBeGreaterThan(0);
  if (expectedProfit !== undefined) {
    expect(result.profitUsd).toBeCloseTo(expectedProfit, 2);
  }
  expect(result.repayAmount ?? 1n).toBeGreaterThan(0n);
  expect(result.seizeAmount ?? 1n).toBeGreaterThan(0n);
};

export const expectLiquidationFailure = (result: LiquidationResult, expectedError?: string): void => {
  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
  if (expectedError) {
    expect(result.error?.toLowerCase()).toContain(expectedError.toLowerCase());
  }
};

export const expectSwapSuccess = (result: SwapResult, expectedAmountOut?: bigint): void => {
  expect(result.success).toBe(true);
  expect(result.txHash).toBeDefined();
  expect(result.amountOut ?? 0n).toBeGreaterThan(0n);
  if (expectedAmountOut !== undefined) {
    expect(result.amountOut).toBe(expectedAmountOut);
  }
};

export const expectRiskCheckPassed = (result: RiskValidationResult): void => {
  expect(result.canProceed).toBe(true);
  expect(result.failedChecks.length).toBe(0);
};

export const expectRiskCheckFailed = (result: RiskValidationResult, expectedCheckType?: RiskCheckType): void => {
  expect(result.canProceed).toBe(false);
  expect(result.failedChecks.length).toBeGreaterThan(0);
  if (expectedCheckType) {
    const contains = result.failedChecks.some((c) => c.checkType === expectedCheckType);
    expect(contains).toBe(true);
  }
};

export const expectPositionLiquidatable = (position: VenusPosition): void => {
  expect(position.healthFactor).toBeLessThan(1.0);
  expect(position.accountLiquidity.shortfall).toBeGreaterThan(0n);
};

export const expectPositionHealthy = (position: VenusPosition): void => {
  expect(position.healthFactor).toBeGreaterThanOrEqual(1.0);
  expect(position.accountLiquidity.liquidity).toBeGreaterThan(0n);
};

export const expectGasEstimateReasonable = (estimate: GasEstimate, maxCostUsd: number): void => {
  expect(estimate.estimatedCostUsd).toBeLessThan(maxCostUsd);
  expect(estimate.estimatedGas).toBeGreaterThan(0n);
};

export const expectProfitabilityAnalysis = (analysis: ProfitabilityAnalysis, shouldBeProfitable: boolean): void => {
  expect(analysis.isProfitable).toBe(shouldBeProfitable);
  const computedNet = analysis.grossProfitUsd - analysis.gasCostUsd - analysis.flashLoanFeeUsd;
  expect(Math.abs(computedNet - analysis.netProfitUsd)).toBeLessThan(0.01);
};

export const expectStrategySelected = (mode: string, expectedMode: string): void => {
  expect(mode).toBe(expectedMode);
};

export const expectStrategyValidation = (isValid: boolean, expectedValid: boolean): void => {
  expect(isValid).toBe(expectedValid);
};

export const expectEngineStats = (
  stats: { totalAttempts: number; successCount: number; failureCount: number; totalProfitUsd: number },
  expected: Partial<typeof stats>,
): void => {
  if (expected.totalAttempts !== undefined) expect(stats.totalAttempts).toBe(expected.totalAttempts);
  if (expected.successCount !== undefined) expect(stats.successCount).toBe(expected.successCount);
  if (expected.failureCount !== undefined) expect(stats.failureCount).toBe(expected.failureCount);
  if (expected.totalProfitUsd !== undefined) expect(stats.totalProfitUsd).toBeCloseTo(expected.totalProfitUsd, 2);
};

export const expectDailyStats = (
  stats: { totalAttempts: number; successCount: number; netProfitUsd: number },
  expected: Partial<typeof stats>,
): void => {
  if (expected.totalAttempts !== undefined) expect(stats.totalAttempts).toBe(expected.totalAttempts);
  if (expected.successCount !== undefined) expect(stats.successCount).toBe(expected.successCount);
  if (expected.netProfitUsd !== undefined) expect(stats.netProfitUsd).toBeCloseTo(expected.netProfitUsd, 2);
};

export const expectCollateralSwapPerformed = (result: SwapResult | null | undefined): void => {
  expect(result).toBeDefined();
  expect(result?.success).toBe(true);
};

export const expectDryRunResult = (result: LiquidationResult): void => {
  expect(result.success).toBe(true);
  expect(result.details?.dryRun).toBe(true);
};

export const expectMockCalled = (mock: any, methodName: string, times?: number): void => {
  const fn = mock[methodName];
  expect(fn).toBeDefined();
  const callCount = fn?.mock?.calls?.length
    ?? mock.getSelectHistory?.()?.length
    ?? mock.getExecutionHistory?.()?.length
    ?? mock.getHandleHistory?.()?.length
    ?? 0;
  if (times !== undefined) {
    expect(callCount).toBe(times);
  } else {
    expect(callCount).toBeGreaterThan(0);
  }
};

export const expectMockCalledWith = (mock: any, methodName: string, expectedArgs: any[]): void => {
  const fn = mock[methodName];
  expect(fn).toBeDefined();
  const calls = fn?.mock?.calls ?? [];
  const match = calls.some((args: any[]) => JSON.stringify(args) === JSON.stringify(expectedArgs));
  expect(match).toBe(true);
};

export const expectHealthFactorValid = (hf: number): void => {
  expect(Number.isFinite(hf) || hf === Number.POSITIVE_INFINITY).toBe(true);
  if (Number.isFinite(hf)) {
    expect(hf).toBeGreaterThanOrEqual(0);
  }
};

export const expectHealthFactorLiquidatable = (hf: number): void => {
  expect(Number.isFinite(hf)).toBe(true);
  expect(hf).toBeLessThan(1.0);
};

export const expectPositionDetailsValid = (position: VenusPosition): void => {
  expect(position.borrower).toBeDefined();
  expectHealthFactorValid(position.healthFactor);
  expect(position.collateralValueUsd).toBeGreaterThanOrEqual(0);
  expect(position.debtValueUsd).toBeGreaterThanOrEqual(0);
  expect(position.collateralTokens).toBeInstanceOf(Array);
  expect(position.borrowTokens).toBeInstanceOf(Array);
  expect(position.accountLiquidity).toBeDefined();
};

export const expectLiquidatablePositionValid = (position: LiquidatablePosition): void => {
  expectPositionDetailsValid(position);
  expect(position.repayToken).toBeDefined();
  expect(position.repayAmount).toBeGreaterThan(0n);
  expect(position.seizeToken).toBeDefined();
  expect(Number.isFinite(position.estimatedProfitUsd)).toBe(true);
  expect(position.lastUpdated).toBeGreaterThan(0);
};

export const expectMonitoringStats = (stats: MonitoringStats, expected: Partial<MonitoringStats>): void => {
  if (expected.totalAccountsTracked !== undefined) {
    expect(stats.totalAccountsTracked).toBe(expected.totalAccountsTracked);
  }
  if (expected.liquidatablePositions !== undefined) {
    expect(stats.liquidatablePositions).toBe(expected.liquidatablePositions);
  }
  if (expected.averageHealthFactor !== undefined) {
    expect(stats.averageHealthFactor).toBeCloseTo(expected.averageHealthFactor, 2);
  }
  if (expected.lastPollTimestamp !== undefined) {
    expect(stats.lastPollTimestamp).toBeGreaterThanOrEqual(expected.lastPollTimestamp);
  }
  if (expected.eventsProcessed !== undefined) {
    expect(stats.eventsProcessed).toBe(expected.eventsProcessed);
  }
};

export const expectPositionTrackerStats = (
  stats: PositionTrackerStats,
  expected: Partial<PositionTrackerStats>,
): void => {
  if (expected.totalAccountsTracked !== undefined) {
    expect(stats.totalAccountsTracked).toBe(expected.totalAccountsTracked);
  }
  if (expected.liquidatablePositions !== undefined) {
    expect(stats.liquidatablePositions).toBe(expected.liquidatablePositions);
  }
  if (expected.averageHealthFactor !== undefined) {
    expect(stats.averageHealthFactor).toBeCloseTo(expected.averageHealthFactor, 2);
  }
};

export const expectAccountLiquidityValid = (liquidity: AccountLiquidity): void => {
  expect(liquidity.error).toBeDefined();
  expect(liquidity.liquidity).toBeGreaterThanOrEqual(0n);
  expect(liquidity.shortfall).toBeGreaterThanOrEqual(0n);
};

export const expectPriceImpactCheck = (check: PriceImpactCheck, expected: Partial<PriceImpactCheck>): void => {
  if (expected.impactPercent !== undefined) {
    expect(Math.abs(check.impactPercent - expected.impactPercent)).toBeLessThanOrEqual(0.001);
  }
  if (expected.isAcceptable !== undefined) expect(check.isAcceptable).toBe(expected.isAcceptable);
  if (expected.maxAllowedImpact !== undefined) expect(check.maxAllowedImpact).toBeCloseTo(expected.maxAllowedImpact, 5);
  expect(check.expectedAmountOut).toBeGreaterThan(0n);
  expect(check.actualAmountOut).toBeGreaterThanOrEqual(0n);
};

export const expectPriceImpactAcceptable = (check: PriceImpactCheck): void => {
  expect(check.isAcceptable).toBe(true);
  expect(check.impactPercent).toBeLessThanOrEqual(check.maxAllowedImpact);
};

export const expectPriceImpactRejected = (check: PriceImpactCheck): void => {
  expect(check.isAcceptable).toBe(false);
  expect(check.impactPercent).toBeGreaterThan(check.maxAllowedImpact);
};

export const expectRouteValid = (route: { path: string[]; fees: number[]; expectedOut: bigint }): void => {
  expect(route.path.length).toBeGreaterThanOrEqual(2);
  expect(route.fees.length).toBe(route.path.length - 1);
  expect(route.expectedOut).toBeGreaterThan(0n);
  route.fees.forEach((fee) => expect(fee).toBeGreaterThan(0));
};

export const expectRouteEmpty = (route: { path: string[]; fees: number[]; expectedOut: bigint }): void => {
  expect(route.path.length).toBe(0);
  expect(route.fees.length).toBe(0);
  expect(route.expectedOut).toBe(0n);
};

export const expectSwapExecutorCalled = (mock: MockSwapExecutor, method: 'single' | 'multi', times?: number): void => {
  const count = mock.getCallCount(method);
  if (times !== undefined) {
    expect(count).toBe(times);
  } else {
    expect(count).toBeGreaterThan(0);
  }
};

export const expectCollateralStats = (
  stats: { swapsAttempted: number; swapsSucceeded: number; swapsFailed: number; totalUsdSwapped: number },
  expected: Partial<{ swapsAttempted: number; swapsSucceeded: number; swapsFailed: number; totalUsdSwapped: number }>,
): void => {
  if (expected.swapsAttempted !== undefined) expect(stats.swapsAttempted).toBe(expected.swapsAttempted);
  if (expected.swapsSucceeded !== undefined) expect(stats.swapsSucceeded).toBe(expected.swapsSucceeded);
  if (expected.swapsFailed !== undefined) expect(stats.swapsFailed).toBe(expected.swapsFailed);
  if (expected.totalUsdSwapped !== undefined) expect(stats.totalUsdSwapped).toBeCloseTo(expected.totalUsdSwapped, 2);
};

export const expectSwapFailure = (result: SwapResult, expectedError?: string): void => {
  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
  if (expectedError) {
    expect(result.error?.toLowerCase()).toContain(expectedError.toLowerCase());
  }
};

export const expectMinAmountOutValid = (minOut: bigint, amountIn: bigint, slippage: number): void => {
  expect(minOut).toBeGreaterThan(0n);
  expect(minOut).toBeLessThan(amountIn);
  const lowerBound = amountIn - (amountIn * BigInt(Math.floor(slippage * 10_000))) / 10_000n;
  expect(minOut).toBeGreaterThanOrEqual(lowerBound);
};

export const expectTokenDecimalsHandled = (
  amount: bigint,
  decimals: number,
  expectedUsd: number,
  price: number,
  tolerance: number,
): void => {
  const human = Number(amount) / 10 ** decimals;
  const usd = human * price;
  expect(Math.abs(usd - expectedUsd)).toBeLessThanOrEqual(tolerance);
};

import { describe, test, expect, beforeEach } from '@jest/globals';
import ExecutionService from '../src/services/execution/ExecutionService';
import { BotConfig, CollateralStrategy, LogLevel } from '../src/types';

const stubConfig: BotConfig = {
  rpcUrl: '',
  chainId: 56,
  privateKey: '0xdeadbeef',
  minProfitUsd: 1,
  minPositionSizeUsd: 1,
  maxPositionSizeUsd: 10_000_000,
  gasPriceMultiplier: 1,
  maxGasPriceGwei: 20,
  useFlashLoans: false,
  flashLoanFeeBps: 9,
  collateralStrategy: CollateralStrategy.AUTO_SELL,
  slippageTolerance: 0.05,
  minSwapAmountUsd: 10,
  maxPriceImpact: 0.1,
  preferredStablecoin: '0x0000000000000000000000000000000000000000',
  pollingIntervalMs: 1_000,
  minHealthFactor: 1.05,
  logLevel: LogLevel.DEBUG,
  logToFile: false,
  venus: { comptroller: '0x0000000000000000000000000000000000000000' },
  dex: { pancakeswapRouter: '0x0000000000000000000000000000000000000000' },
  execution: {
    intervalMs: 10,
    maxRetries: 3,
    baseRetryDelayMs: 100,
    maxRetryDelayMs: 10_000,
    successCooldownMs: 0,
  },
};

const monitoringStub = { getLiquidatablePositions: () => [] } as any;
const liquidationStub = { getEmergencyStopState: () => ({ isActive: false }) } as any;

describe('ExecutionService Retry Logic', () => {
  let service: ExecutionService;
  let scheduleRetry: any;
  let retryStates: Map<string, any>;
  const borrower = '0xabc';
  const repayToken = '0xdef';
  const seizeToken = '0xghi';
  const positionKey = `${borrower.toLowerCase()}|${repayToken.toLowerCase()}|${seizeToken.toLowerCase()}`;

  beforeEach(() => {
    service = new ExecutionService(monitoringStub, liquidationStub, stubConfig);
    scheduleRetry = (service as any).scheduleRetry.bind(service);
    retryStates = (service as any).retryStates as Map<string, any>;
  });

  test('schedules first retry on failure', () => {
    scheduleRetry(positionKey, borrower, 'fail-1');
    expect(retryStates.get(positionKey)?.retryCount).toBe(1);
  });

  test('increments retry count on subsequent failures', () => {
    scheduleRetry(positionKey, borrower, 'fail-1');
    scheduleRetry(positionKey, borrower, 'fail-2');
    expect(retryStates.get(positionKey)?.retryCount).toBe(2);
  });

  test('allows up to maxRetries attempts', () => {
    scheduleRetry(positionKey, borrower, 'fail-1');
    scheduleRetry(positionKey, borrower, 'fail-2');
    scheduleRetry(positionKey, borrower, 'fail-3');
    expect(retryStates.get(positionKey)?.retryCount).toBe(3);
  });

  test('clears retry state after exceeding maxRetries', () => {
    scheduleRetry(positionKey, borrower, 'fail-1');
    scheduleRetry(positionKey, borrower, 'fail-2');
    scheduleRetry(positionKey, borrower, 'fail-3');
    scheduleRetry(positionKey, borrower, 'fail-4');
    expect(retryStates.has(positionKey)).toBe(false);
  });

  test('applies exponential backoff within limits', () => {
    const now = Date.now();
    scheduleRetry(positionKey, borrower, 'fail-1');
    const first = retryStates.get(positionKey);
    expect(first.nextRetryAt - now).toBeGreaterThanOrEqual(stubConfig.execution!.baseRetryDelayMs);
    scheduleRetry(positionKey, borrower, 'fail-2');
    const second = retryStates.get(positionKey);
    expect(second.retryCount).toBe(2);
    expect(second.nextRetryAt).toBeGreaterThan(first.nextRetryAt);
  });

  test('removes backoff entry when max retries exceeded', () => {
    scheduleRetry(positionKey, borrower, 'fail-1');
    scheduleRetry(positionKey, borrower, 'fail-2');
    scheduleRetry(positionKey, borrower, 'fail-3');
    scheduleRetry(positionKey, borrower, 'fail-4');
    expect(retryStates.size).toBe(0);
  });
});

import LiquidationEngine from '../../src/services/liquidation/LiquidationEngine';
import { LiquidationMode } from '../../src/types';
import {
  createBotConfig,
  createLiquidatablePosition,
  createMockCollateralManager,
  createMockFlashLoanLiquidator,
  createMockLiquidationStrategy,
  createMockProfitabilityCalculator,
  createMockRiskManager,
  createMockStandardLiquidator,
  createMockTransactionBuilder,
  createMockVenusContractsWrapper,
  createMockPriceService,
} from '../utils';

const buildEngineWithMocks = () => {
  const config = createBotConfig({ useFlashLoans: true, dryRun: false });
  const { wrapper: venusContracts } = createMockVenusContractsWrapper();
  const signer: any = { address: '0xsigner' };
  const provider: any = {};
  const priceService = createMockPriceService();

  const engine = new LiquidationEngine(venusContracts as any, signer, provider, config, priceService as any) as any;

  engine.profitabilityCalculator = createMockProfitabilityCalculator();
  engine.transactionBuilder = createMockTransactionBuilder();
  engine.standardLiquidator = createMockStandardLiquidator();
  engine.flashLoanLiquidator = createMockFlashLoanLiquidator();
  engine.liquidationStrategy = createMockLiquidationStrategy();
  engine.collateralManager = createMockCollateralManager();
  engine.riskManager = createMockRiskManager();
  engine.liquidationBonusPercent = 8;

  return { engine, config };
};

describe('LiquidationEngine', () => {
  test('executeLiquidation short-circuits when strategy validation fails', async () => {
    const { engine } = buildEngineWithMocks();
    engine.liquidationStrategy.mockValidation(false);
    const position = createLiquidatablePosition();

    const result = await engine.executeLiquidation(position);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Strategy validation failed');
  });

  test('executeLiquidation returns failure when risk validation fails', async () => {
    const { engine } = buildEngineWithMocks();
    engine.riskManager.mockInsufficientBalance();
    const position = createLiquidatablePosition();

    const result = await engine.executeLiquidation(position);

    expect(result.success).toBe(false);
    expect(result.error?.toLowerCase()).toContain('risk checks failed');
    expect(engine.riskManager.getRecordHistory().length).toBe(1);
  });

  test('executeLiquidation dry-run sets dryRun flag and skips liquidators', async () => {
    const { engine } = buildEngineWithMocks();
    engine.config = { ...engine.config, dryRun: true };
    const position = createLiquidatablePosition();

    const result = await engine.executeLiquidation(position);

    expect(result.success).toBe(true);
    expect(result.details?.dryRun).toBe(true);
    expect(engine.getStats().dryRunAttempts).toBe(1);
  });

  test('executeLiquidation standard path updates stats on success', async () => {
    const { engine } = buildEngineWithMocks();
    engine.liquidationStrategy.mockSelectedMode(LiquidationMode.STANDARD);
    const position = createLiquidatablePosition({ estimatedProfitUsd: 60 });

    const result = await engine.executeLiquidation(position);

    expect(result.success).toBe(true);
    const stats = engine.getStats();
    expect(stats.successCount).toBe(1);
    expect(stats.totalProfitUsd).toBeGreaterThan(0);
  });

  test('canExecute respects size and profit thresholds', async () => {
    const { engine } = buildEngineWithMocks();
    const smallPosition = createLiquidatablePosition({ debtValueUsd: 10, estimatedProfitUsd: 5 });
    const largePosition = createLiquidatablePosition({ debtValueUsd: 2_000_000, estimatedProfitUsd: 500 });
    const okPosition = createLiquidatablePosition({ debtValueUsd: 10_000, estimatedProfitUsd: 100 });

    expect(await engine.canExecute(smallPosition)).toBe(false);
    expect(await engine.canExecute(largePosition)).toBe(false);
    expect(await engine.canExecute(okPosition)).toBe(true);
  });
});

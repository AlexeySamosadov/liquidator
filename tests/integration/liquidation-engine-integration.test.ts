import LiquidationEngine from '../../src/services/liquidation/LiquidationEngine';
import { LiquidationMode } from '../../src/types';
import {
  createBotConfig,
  createFlashLoanConfig,
  createLiquidatablePosition,
  createMockCollateralManager,
  createMockFlashLoanLiquidator,
  createMockLiquidationStrategy,
  createMockPriceService,
  createMockProfitabilityCalculator,
  createMockRiskManager,
  createMockStandardLiquidator,
  createMockTransactionBuilder,
  createMockVenusContractsWrapper,
} from '../utils';

const buildEngine = (configOverrides: any = {}, strategyMode: LiquidationMode = LiquidationMode.STANDARD) => {
  const config = configOverrides.useFlashLoans ? createFlashLoanConfig(configOverrides) : createBotConfig(configOverrides);
  const { wrapper: venusContracts } = createMockVenusContractsWrapper();
  const signer: any = { address: '0xsigner' };
  const provider: any = {};
  const priceService = createMockPriceService();

  const engine = new LiquidationEngine(venusContracts as any, signer, provider, config, priceService as any) as any;

  const strategy = createMockLiquidationStrategy({ mode: strategyMode });
  const risk = createMockRiskManager();
  const profit = createMockProfitabilityCalculator();
  const tx = createMockTransactionBuilder();
  const std = createMockStandardLiquidator();
  const flash = createMockFlashLoanLiquidator();
  const collateral = createMockCollateralManager();

  engine.liquidationStrategy = strategy;
  engine.riskManager = risk;
  engine.profitabilityCalculator = profit;
  engine.transactionBuilder = tx;
  engine.standardLiquidator = std;
  engine.flashLoanLiquidator = flash;
  engine.collateralManager = collateral;
  engine.liquidationBonusPercent = 8;

  return { engine, strategy, risk, profit, tx, std, flash, collateral, config };
};

describe('LiquidationEngine integration-lite', () => {
  test('full standard flow executes and records stats', async () => {
    const { engine, strategy, risk, std } = buildEngine({ useFlashLoans: false }, LiquidationMode.STANDARD);
    const position = createLiquidatablePosition({ estimatedProfitUsd: 80 });

    const result = await engine.executeLiquidation(position);

    expect(result.success).toBe(true);
    expect(strategy.getSelectHistory().length).toBe(1);
    expect(risk.getRecordHistory().length).toBe(1);
    expect(std.getExecutionHistory().length).toBe(1);
    expect(engine.getStats().successCount).toBe(1);
  });

  test('flash loan flow uses flash liquidator when strategy requests', async () => {
    const { engine, flash, strategy } = buildEngine({ useFlashLoans: true }, LiquidationMode.FLASH_LOAN);
    const position = createLiquidatablePosition({ estimatedProfitUsd: 60 });

    const result = await engine.executeLiquidation(position);

    expect(result.mode).toBe(LiquidationMode.FLASH_LOAN);
    expect(flash.getExecutionHistory().length).toBe(1);
    expect(engine.getStats().successCount).toBe(1);
    expect(strategy.getSelectHistory().length).toBe(1);
  });

  test('risk validation blocks execution and increments failure count', async () => {
    const { engine, risk } = buildEngine({ useFlashLoans: false }, LiquidationMode.STANDARD);
    risk.mockEmergencyStopActive();
    const position = createLiquidatablePosition();

    const result = await engine.executeLiquidation(position);

    expect(result.success).toBe(false);
    expect(engine.getStats().failureCount).toBe(0);
  });

  test('unprofitable liquidation returns failure', async () => {
    const { engine, profit } = buildEngine({ useFlashLoans: false }, LiquidationMode.STANDARD);
    profit.mockProfitability({
      grossProfitUsd: 5,
      gasCostUsd: 10,
      flashLoanFeeUsd: 0,
      netProfitUsd: -5,
      profitMargin: -1,
      isProfitable: false,
      recommendedMode: LiquidationMode.STANDARD,
    });
    const position = createLiquidatablePosition({ estimatedProfitUsd: 5 });

    const result = await engine.executeLiquidation(position);

    expect(result.success).toBe(false);
    expect(result.error?.toLowerCase()).toContain('not profitable');
  });
});

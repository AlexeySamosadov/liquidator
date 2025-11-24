import PositionTracker from '../../src/services/monitoring/PositionTracker';
import { createLiquidatablePosition, createVenusPosition } from '../utils/positionFactory';
import { createMockHealthFactorCalculator, createMockPriceService } from '../utils/mockFactory';
import { expectLiquidatablePositionValid, expectPositionTrackerStats } from '../utils/assertions';
import { TEST_TOKENS, MIN_POSITION_SIZE_USD } from '../utils/testData';
import { parseUnits } from 'ethers';

const buildTracker = (minHealthFactor = 1.0, minPositionSizeUsd = MIN_POSITION_SIZE_USD) => {
  const hfc = createMockHealthFactorCalculator();
  hfc.setLiquidationIncentive(1.1);
  const priceService: any = createMockPriceService();
  priceService.getTokenPriceUsd = jest.fn(async () => 1);
  priceService.getVTokenPriceUsd = jest.fn(async () => 0.8);
  const gasEstimator = jest.fn(async () => 0.1);
  const tracker = new PositionTracker(hfc as any, priceService as any, minHealthFactor, minPositionSizeUsd, gasEstimator);
  return { tracker, hfc, priceService, gasEstimator };
};

describe('PositionTracker', () => {
  test('initial stats are zero', () => {
    const { tracker } = buildTracker();
    const stats = tracker.getStats();
    expect(stats.totalAccountsTracked).toBe(0);
    expect(stats.liquidatablePositions).toBe(0);
    expect(stats.averageHealthFactor).toBe(0);
  });

  test('tracks healthy positions without marking liquidatable', async () => {
    const { tracker } = buildTracker();
    const healthy = createVenusPosition({ healthFactor: 1.2, debtValueUsd: 5_000 });

    await tracker.updatePosition(healthy);

    expect(tracker.getLiquidatablePositions().length).toBe(0);
    expect(tracker.getPosition(healthy.borrower)).toBeDefined();
  });

  test('adds liquidatable position and sorts by profit', async () => {
    const { tracker } = buildTracker(1.0, 100);
    const lowProfit = createLiquidatablePosition({ borrower: '0x1', estimatedProfitUsd: 10, healthFactor: 0.7 });
    const highProfit = createLiquidatablePosition({ borrower: '0x2', estimatedProfitUsd: 200, healthFactor: 0.6 });

    await tracker.updatePosition(lowProfit);
    await tracker.updatePosition(highProfit);

    const liquidatable = tracker.getLiquidatablePositions();
    expect(liquidatable.length).toBe(2);
    expect(liquidatable[0].borrower).toBe(highProfit.borrower);
    expect(liquidatable[1].borrower).toBe(lowProfit.borrower);
    expectLiquidatablePositionValid(liquidatable[0]);
  });

  test('removes from liquidatable when recovered', async () => {
    const { tracker } = buildTracker();
    const borrower = '0xabc';
    const liquid = createLiquidatablePosition({ borrower, healthFactor: 0.6 });
    const recovered = createVenusPosition({ borrower, healthFactor: 1.2, debtValueUsd: 1_000 });

    await tracker.updatePosition(liquid);
    expect(tracker.getLiquidatablePositions().length).toBe(1);

    await tracker.updatePosition(recovered);
    expect(tracker.getLiquidatablePositions().length).toBe(0);
  });

  test('skips positions when repay calculation is non-finite', async () => {
    const { tracker } = buildTracker();
    const bad = createVenusPosition({
      healthFactor: 0.5,
      debtValueUsd: 5_000,
      borrowDetails: [
        {
          vToken: TEST_TOKENS.USDT,
          underlying: TEST_TOKENS.USDT,
          amount: 1000n,
          valueUsd: Number.NaN,
          decimals: 6,
        },
      ],
    });

    await tracker.updatePosition(bad);

    expect(tracker.getLiquidatablePositions().length).toBe(0);
  });

  test('stats reflect tracked and liquidatable counts with average HF', async () => {
    const { tracker } = buildTracker();
    const p1 = createVenusPosition({ healthFactor: 1.5, debtValueUsd: 1_000 });
    const p2 = createVenusPosition({ healthFactor: 0.8, debtValueUsd: 2_000 });

    await tracker.updatePosition(p1);
    await tracker.updatePosition(p2);

    const stats = tracker.getStats();
    expectPositionTrackerStats(stats, { totalAccountsTracked: 2, liquidatablePositions: 1, averageHealthFactor: (p1.healthFactor + p2.healthFactor) / 2 });
  });

  test('clear removes all tracked state', async () => {
    const { tracker } = buildTracker();
    await tracker.updatePosition(createLiquidatablePosition());
    tracker.clear();

    expect(tracker.getAllPositions().length).toBe(0);
    expect(tracker.getLiquidatablePositions().length).toBe(0);
  });

  test('uses fallback gas estimate when estimator throws', async () => {
    const hfc = createMockHealthFactorCalculator();
    hfc.setLiquidationIncentive(1.2);
    const priceService: any = createMockPriceService();
    priceService.getTokenPriceUsd = jest.fn(async () => 2);
    priceService.getVTokenPriceUsd = jest.fn(async () => 0);
    const gasEstimator = jest.fn(async () => {
      throw new Error('gas fail');
    });
    const tracker = new PositionTracker(hfc as any, priceService as any, 1.0, 100, gasEstimator);

    const position = createVenusPosition({
      healthFactor: 0.6,
      debtValueUsd: 2_000,
      borrowTokens: [TEST_TOKENS.USDT],
      borrowDetails: [
        {
          vToken: TEST_TOKENS.USDT,
          underlying: TEST_TOKENS.USDT,
          amount: BigInt(parseUnits('1000', 18).toString()),
          valueUsd: 2_000,
          decimals: 18,
        },
      ],
      collateralTokens: [TEST_TOKENS.WBNB],
      collateralDetails: [
        {
          vToken: TEST_TOKENS.WBNB,
          amount: BigInt(parseUnits('10', 18).toString()),
          valueUsd: 3_000,
          decimals: 18,
        },
      ],
    });

    await tracker.updatePosition(position);

    const [liquidatable] = tracker.getLiquidatablePositions();
    expect(liquidatable).toBeDefined();
    // repayAmountUsd = 500 * 2 = 1000; profit = 1000 * (1.2 - 1) - 0.1
    expect(liquidatable.estimatedProfitUsd).toBeCloseTo(199.9, 1);
    expect(gasEstimator).toHaveBeenCalled();
  });

  test('falls back to default liquidation incentive when fetch rejects', async () => {
    const hfc = createMockHealthFactorCalculator();
    jest.spyOn(hfc as any, 'getLiquidationIncentive').mockRejectedValueOnce(new Error('incentive fail'));
    const priceService: any = createMockPriceService();
    priceService.getTokenPriceUsd = jest.fn(async () => 1);
    priceService.getVTokenPriceUsd = jest.fn(async () => 0);
    const tracker = new PositionTracker(hfc as any, priceService as any, 1.0, 100, async () => 0.05);

    const position = createVenusPosition({
      healthFactor: 0.7,
      debtValueUsd: 500,
      borrowTokens: [TEST_TOKENS.USDT],
      borrowDetails: [
        {
          vToken: TEST_TOKENS.USDT,
          underlying: TEST_TOKENS.USDT,
          amount: BigInt(parseUnits('200', 18).toString()),
          valueUsd: 200,
          decimals: 18,
        },
      ],
    });

    await tracker.updatePosition(position);

    const [liquidatable] = tracker.getLiquidatablePositions();
    expect(liquidatable).toBeDefined();
    // repayAmountUsd = 100 * 1 = 100; incentive fallback 1.1; gas 0.05
    expect(liquidatable.estimatedProfitUsd).toBeCloseTo(9.95, 2);
  });

  test('resolveRepayTokenPriceUsd prefers underlying price when available', async () => {
    const hfc = createMockHealthFactorCalculator({ defaultHealthFactor: 0.6 });
    const priceService: any = createMockPriceService();
    const tokenPriceSpy = jest.fn(async () => 5);
    const vTokenPriceSpy = jest.fn(async () => 2);
    priceService.getTokenPriceUsd = tokenPriceSpy;
    priceService.getVTokenPriceUsd = vTokenPriceSpy;
    const tracker = new PositionTracker(hfc as any, priceService as any, 1.0, 100);

    const position = createVenusPosition({
      healthFactor: 0.5,
      debtValueUsd: 1_000,
      borrowTokens: [TEST_TOKENS.USDT],
      borrowDetails: [
        {
          vToken: TEST_TOKENS.USDT,
          underlying: TEST_TOKENS.USDT,
          amount: BigInt(parseUnits('100', 18).toString()),
          valueUsd: 500,
          decimals: 18,
        },
      ],
    });

    await tracker.updatePosition(position);

    const [liquidatable] = tracker.getLiquidatablePositions();
    expect(liquidatable?.repayTokenPriceUsd).toBe(5);
    expect(tokenPriceSpy).toHaveBeenCalled();
    expect(vTokenPriceSpy).not.toHaveBeenCalled();
  });

  test('falls back to vToken price when underlying price is zero', async () => {
    const hfc = createMockHealthFactorCalculator({ defaultHealthFactor: 0.6 });
    const priceService: any = createMockPriceService();
    priceService.getTokenPriceUsd = jest.fn(async () => 0);
    priceService.getVTokenPriceUsd = jest.fn(async () => 3);
    const tracker = new PositionTracker(hfc as any, priceService as any, 1.0, 100);

    const position = createVenusPosition({
      healthFactor: 0.5,
      debtValueUsd: 1_000,
      borrowTokens: [TEST_TOKENS.USDT],
      borrowDetails: [
        {
          vToken: TEST_TOKENS.USDT,
          underlying: TEST_TOKENS.USDT,
          amount: BigInt(parseUnits('50', 18).toString()),
          valueUsd: 150,
          decimals: 18,
        },
      ],
    });

    await tracker.updatePosition(position);

    const [liquidatable] = tracker.getLiquidatablePositions();
    expect(liquidatable?.repayTokenPriceUsd).toBe(3);
  });

  test('derives price from position when oracle prices are zero', async () => {
    const hfc = createMockHealthFactorCalculator({ defaultHealthFactor: 0.6 });
    const priceService: any = createMockPriceService();
    priceService.getTokenPriceUsd = jest.fn(async () => 0);
    priceService.getVTokenPriceUsd = jest.fn(async () => 0);
    const tracker = new PositionTracker(hfc as any, priceService as any, 1.0, 100);

    const valueUsd = 1_000;
    const amount = BigInt(parseUnits('100', 18).toString());
    const position = createVenusPosition({
      healthFactor: 0.5,
      debtValueUsd: 1_000,
      borrowTokens: [TEST_TOKENS.USDT],
      borrowDetails: [
        {
          vToken: TEST_TOKENS.USDT,
          underlying: TEST_TOKENS.USDT,
          amount,
          valueUsd,
          decimals: 18,
        },
      ],
    });

    await tracker.updatePosition(position);

    const [liquidatable] = tracker.getLiquidatablePositions();
    expect(liquidatable?.repayTokenPriceUsd).toBeCloseTo(10, 5);
  });

  test('skips liquidatable position when repayment math becomes non-finite', async () => {
    const hfc = createMockHealthFactorCalculator({ defaultHealthFactor: 0.4 });
    const priceService: any = createMockPriceService();
    priceService.getTokenPriceUsd = jest.fn(async () => Number.POSITIVE_INFINITY);
    priceService.getVTokenPriceUsd = jest.fn(async () => 0);
    const tracker = new PositionTracker(hfc as any, priceService as any, 1.0, 100);

    const position = createVenusPosition({
      healthFactor: 0.3,
      debtValueUsd: 10_000,
      borrowTokens: [TEST_TOKENS.USDT],
      borrowDetails: [
        {
          vToken: TEST_TOKENS.USDT,
          underlying: TEST_TOKENS.USDT,
          amount: BigInt(parseUnits('5000', 18).toString()),
          valueUsd: 10_000,
          decimals: 18,
        },
      ],
    });

    await tracker.updatePosition(position);

    expect(tracker.getLiquidatablePositions().length).toBe(0);
  });
});

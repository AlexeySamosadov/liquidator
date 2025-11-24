import { describe, expect, it, beforeEach } from '@jest/globals';
import { JsonRpcProvider, parseUnits } from 'ethers';
import CollateralManager from '../../src/services/dex/CollateralManager';
import { COMMON_TOKENS } from '../../src/config/tokens';
import { CollateralStrategy, LiquidationResult } from '../../src/types';
import { createBotConfig, createCollateralSwapConfig } from '../utils/configFactory';
import {
  DIRECT_ROUTE_WBNB_USDT,
  EXPECTED_OUT_BTCB_TO_USDT,
  EXPECTED_OUT_WBNB_TO_USDT,
  MIN_SWAP_AMOUNT_USD,
  SWAP_AMOUNT_BTCB,
  SWAP_AMOUNT_WBNB,
  TEST_TOKENS,
} from '../utils/testData';
import {
  createMockCollateralEnvironment,
  createMockPriceImpactChecker,
  createMockRouteOptimizer,
  createMockSwapExecutor,
  createMockProvider,
  createMockSigner,
} from '../utils/mockFactory';
import { expectCollateralStats, expectRouteValid, expectSwapExecutorCalled, expectSwapFailure } from '../utils/assertions';

const buildManager = (overrides?: { strategy?: CollateralStrategy }) => {
  const provider = createMockProvider();
  const signer = createMockSigner({ provider });
  const executor = createMockSwapExecutor({ success: true, amountOut: EXPECTED_OUT_WBNB_TO_USDT });
  const impactChecker = createMockPriceImpactChecker({ impactPercent: 0.01, isAcceptable: true });
  const optimizer = createMockRouteOptimizer({ defaultRoute: true });

  const config = createBotConfig({
    collateralStrategy: overrides?.strategy ?? CollateralStrategy.AUTO_SELL,
    minSwapAmountUsd: MIN_SWAP_AMOUNT_USD,
  });

  const collateralConfig = createCollateralSwapConfig({
    strategy: overrides?.strategy ?? CollateralStrategy.AUTO_SELL,
    targetStablecoins: [COMMON_TOKENS.USDT],
  });

  const manager = new CollateralManager(
    executor as any,
    impactChecker as any,
    optimizer as any,
    config,
    signer as unknown as any,
    collateralConfig,
  );

  return { manager, executor, impactChecker, optimizer, signer };
};

describe('CollateralManager', () => {
  let liquidationResult: LiquidationResult;

  beforeEach(() => {
    liquidationResult = { success: true, amountOut: 0n, amountIn: 0n } as unknown as LiquidationResult;
  });

  it('returns null for HOLD strategy', async () => {
    const { manager, executor } = buildManager({ strategy: CollateralStrategy.HOLD });

    const res = await manager.handleCollateral(TEST_TOKENS.WBNB, SWAP_AMOUNT_WBNB, liquidationResult);

    expect(res).toBeNull();
    expectSwapExecutorCalled(executor, 'single', 0);
    expect(manager.getStats().swapsAttempted).toBe(0);
  });

  it('skips swap when collateral already stablecoin (AUTO_SELL)', async () => {
    const { manager } = buildManager({ strategy: CollateralStrategy.AUTO_SELL });

    const amount = parseUnits('1000', 18);
    const res = await manager.handleCollateral(TEST_TOKENS.USDT, amount, liquidationResult);

    expect(res?.success).toBe(true);
    expect(res?.tokenIn).toBe(TEST_TOKENS.USDT);
    expect(manager.getStats().swapsAttempted).toBe(0);
  });

  it('performs single-hop swap for non-stable collateral', async () => {
    const { manager, executor, optimizer } = buildManager();
    optimizer.mockDirectRoute(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, 500, EXPECTED_OUT_WBNB_TO_USDT);

    const res = await manager.handleCollateral(TEST_TOKENS.WBNB, SWAP_AMOUNT_WBNB, liquidationResult);

    expect(res?.success).toBe(true);
    expect(res?.tokenOut).toBe(TEST_TOKENS.USDT);
    expectRouteValid(await optimizer.findBestRoute(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, SWAP_AMOUNT_WBNB));
    expectSwapExecutorCalled(executor, 'single');
    expectCollateralStats(manager.getStats(), { swapsAttempted: 1, swapsSucceeded: 1 });
  });

  it('rejects swap when price impact too high', async () => {
    const { manager, impactChecker } = buildManager();
    impactChecker.mockImpactCheck(0.2, false);

    const res = await manager.handleCollateral(TEST_TOKENS.WBNB, SWAP_AMOUNT_WBNB, liquidationResult);

    expect(res).toBeNull();
    expect(manager.getStats().swapsAttempted).toBe(0);
  });

  it('skips swap when below min USD threshold', async () => {
    const { manager } = buildManager();
    const tiny = parseUnits('0.001', 18);

    const res = await manager.handleCollateral(TEST_TOKENS.WBNB, tiny, liquidationResult);

    expect(res).toBeNull();
    expect(manager.getStats().swapsAttempted).toBe(0);
  });

  it('handles multi-hop preferred path in CONFIGURABLE strategy', async () => {
    const provider = createMockProvider();
    const signer = createMockSigner({ provider });
    const executor = createMockSwapExecutor({ success: true, amountOut: EXPECTED_OUT_BTCB_TO_USDT });
    const impactChecker = createMockPriceImpactChecker({ impactPercent: 0.02, isAcceptable: true });
    const optimizer = createMockRouteOptimizer();

    const config = createBotConfig({ collateralStrategy: CollateralStrategy.CONFIGURABLE, minSwapAmountUsd: MIN_SWAP_AMOUNT_USD });
    const tokenConfigs = new Map([
      [TEST_TOKENS.BTCB.toLowerCase(), {
        address: TEST_TOKENS.BTCB,
        symbol: 'BTCB',
        decimals: 8,
        isStablecoin: false,
        autoSell: true,
        preferredSwapPath: DIRECT_ROUTE_WBNB_USDT,
      }],
    ]);
    const collateralConfig = createCollateralSwapConfig({
      strategy: CollateralStrategy.CONFIGURABLE,
      targetStablecoins: [COMMON_TOKENS.USDT],
      tokenConfigs,
    });

    const manager = new CollateralManager(
      executor as any,
      impactChecker as any,
      optimizer as any,
      config,
      signer as unknown as any,
      collateralConfig,
    );

    const res = await manager.handleCollateral(TEST_TOKENS.BTCB, SWAP_AMOUNT_BTCB, liquidationResult);
    expect(res?.success).toBe(true);
    expect(res?.tokenOut).toBe(TEST_TOKENS.USDT);
    expectCollateralStats(manager.getStats(), { swapsAttempted: 1, swapsSucceeded: 1 });
  });

  it('increments failed stats when swap fails', async () => {
    const provider = createMockProvider();
    const signer = createMockSigner({ provider });
    const executor = createMockSwapExecutor({ success: false });
    const impactChecker = createMockPriceImpactChecker({ impactPercent: 0.01, isAcceptable: true });
    const optimizer = createMockRouteOptimizer({ defaultRoute: true });
    const config = createBotConfig({ collateralStrategy: CollateralStrategy.AUTO_SELL });
    const collateralConfig = createCollateralSwapConfig({ strategy: CollateralStrategy.AUTO_SELL });

    const manager = new CollateralManager(executor as any, impactChecker as any, optimizer as any, config, signer as any, collateralConfig);

    const res = await manager.handleCollateral(TEST_TOKENS.WBNB, SWAP_AMOUNT_WBNB, liquidationResult);
    if (res) expectSwapFailure(res, 'Swap failed');
    expectCollateralStats(manager.getStats(), { swapsAttempted: 1, swapsFailed: 1 });
  });
});

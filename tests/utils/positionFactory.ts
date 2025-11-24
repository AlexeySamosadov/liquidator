import { AccountLiquidity, LiquidatablePosition, TokenPositionDetail, VenusPosition } from '../../src/types';
import { DEFAULT_HEALTH_FACTOR, LIQUIDATION_THRESHOLD, TEST_TOKENS, TEST_VTOKENS } from './testData';
import { parseUnits } from 'ethers';
import { randomAddress } from './testHelpers';

const defaultAccountLiquidity = (healthFactor: number): AccountLiquidity => {
  const liquidity = healthFactor > LIQUIDATION_THRESHOLD ? parseUnits('1000', 18) : 0n;
  const shortfall = healthFactor < LIQUIDATION_THRESHOLD ? parseUnits('100', 18) : 0n;
  return {
    error: 0n,
    liquidity,
    shortfall,
  };
};

export const createAccountLiquidity = (overrides: Partial<AccountLiquidity> = {}, healthFactor: number = DEFAULT_HEALTH_FACTOR): AccountLiquidity => ({
  ...defaultAccountLiquidity(healthFactor),
  ...overrides,
});

export const createTokenPositionDetail = (overrides: Partial<TokenPositionDetail> = {}): TokenPositionDetail => ({
  vToken: TEST_VTOKENS.vWBNB,
  underlying: TEST_TOKENS.WBNB,
  amount: parseUnits('1', 18),
  valueUsd: 300,
  decimals: 18,
  ...overrides,
});

export const createVenusPosition = (overrides: Partial<VenusPosition> = {}): VenusPosition => {
  const healthFactor = overrides.healthFactor ?? DEFAULT_HEALTH_FACTOR;
  const accountLiquidity = createAccountLiquidity(overrides.accountLiquidity ?? {}, healthFactor);

  return {
    borrower: overrides.borrower ?? randomAddress(),
    healthFactor,
    collateralValueUsd: overrides.collateralValueUsd ?? 10_000,
    debtValueUsd: overrides.debtValueUsd ?? 6_000,
    collateralTokens: overrides.collateralTokens ?? [TEST_TOKENS.WBNB],
    borrowTokens: overrides.borrowTokens ?? [TEST_TOKENS.USDT],
    collateralDetails: overrides.collateralDetails ?? [createTokenPositionDetail()],
    borrowDetails: overrides.borrowDetails ?? [],
    accountLiquidity,
  };
};

export const createLiquidatablePosition = (
  overrides: Partial<LiquidatablePosition> = {},
): LiquidatablePosition => {
  const base = createVenusPosition({
    healthFactor: overrides.healthFactor ?? 0.95,
    ...overrides,
  });

  return {
    ...base,
    repayToken: overrides.repayToken ?? TEST_TOKENS.USDT,
    repayAmount: overrides.repayAmount ?? parseUnits('1000', 18),
    seizeToken: overrides.seizeToken ?? TEST_TOKENS.WBNB,
    repayTokenDecimals: overrides.repayTokenDecimals ?? 18,
    repayTokenPriceUsd: overrides.repayTokenPriceUsd ?? 1,
    estimatedProfitUsd: overrides.estimatedProfitUsd ?? 50,
    lastUpdated: overrides.lastUpdated ?? Date.now(),
  };
};

export const createHealthyPosition = (overrides: Partial<LiquidatablePosition> = {}): LiquidatablePosition =>
  createLiquidatablePosition({
    healthFactor: overrides.healthFactor ?? 1.2,
    accountLiquidity: createAccountLiquidity({}, 1.2),
    estimatedProfitUsd: overrides.estimatedProfitUsd ?? 0,
    ...overrides,
  });

export const createUnhealthyPosition = (overrides: Partial<LiquidatablePosition> = {}): LiquidatablePosition =>
  createLiquidatablePosition({
    healthFactor: overrides.healthFactor ?? 0.8,
    accountLiquidity: createAccountLiquidity({}, 0.8),
    estimatedProfitUsd: overrides.estimatedProfitUsd ?? 100,
    ...overrides,
  });

export const createLargePosition = (overrides: Partial<LiquidatablePosition> = {}): LiquidatablePosition =>
  createLiquidatablePosition({
    collateralValueUsd: overrides.collateralValueUsd ?? 150_000,
    debtValueUsd: overrides.debtValueUsd ?? 90_000,
    estimatedProfitUsd: overrides.estimatedProfitUsd ?? 500,
    ...overrides,
  });

export const createSmallPosition = (overrides: Partial<LiquidatablePosition> = {}): LiquidatablePosition =>
  createLiquidatablePosition({
    collateralValueUsd: overrides.collateralValueUsd ?? 800,
    debtValueUsd: overrides.debtValueUsd ?? 500,
    estimatedProfitUsd: overrides.estimatedProfitUsd ?? 10,
    ...overrides,
  });

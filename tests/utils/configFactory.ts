import { CollateralStrategy, BotConfig, ExecutionConfig, CollateralSwapConfig, LogLevel } from '../../src/types';
import { COMMON_TOKENS, DEFAULT_TOKEN_CONFIGS } from '../../src/config/tokens';
import { TEST_ADDRESSES } from './testData';

const baseConfig: BotConfig = {
  rpcUrl: 'http://localhost:8545',
  chainId: 56,
  privateKey: '0x0123456789012345678901234567890123456789012345678901234567890123',
  minProfitUsd: 10,
  minPositionSizeUsd: 100,
  maxPositionSizeUsd: 1_000_000,
  gasPriceMultiplier: 1.1,
  maxGasPriceGwei: 20,
  useFlashLoans: false,
  flashLoanFeeBps: 9,
  collateralStrategy: CollateralStrategy.AUTO_SELL,
  slippageTolerance: 0.05,
  minSwapAmountUsd: 10,
  maxPriceImpact: 0.1,
  preferredStablecoin: COMMON_TOKENS.USDT,
  pollingIntervalMs: 5_000,
  minHealthFactor: 1.05,
  logLevel: LogLevel.DEBUG,
  logToFile: false,
  venus: {
    comptroller: TEST_ADDRESSES.comptroller,
    oracle: TEST_ADDRESSES.oracle,
  },
  dex: {
    pancakeswapRouter: TEST_ADDRESSES.router,
    pancakeswapV3Factory: TEST_ADDRESSES.factory,
  },
  flashLiquidatorContract: TEST_ADDRESSES.liquidator,
  healthyPollsBeforeDrop: 2,
  maxDailyLossUsd: 10_000,
  execution: {
    intervalMs: 1_000,
    maxRetries: 3,
    baseRetryDelayMs: 1_000,
    maxRetryDelayMs: 60_000,
    successCooldownMs: 5_000,
  },
};

export const createBotConfig = (overrides: Partial<BotConfig> = {}): BotConfig => ({
  ...baseConfig,
  ...overrides,
  venus: { ...baseConfig.venus, ...(overrides.venus ?? {}) },
  dex: { ...baseConfig.dex, ...(overrides.dex ?? {}) },
  execution: { ...baseConfig.execution!, ...(overrides.execution ?? {}) },
});

export const createStandardLiquidationConfig = (overrides: Partial<BotConfig> = {}): BotConfig =>
  createBotConfig({ useFlashLoans: false, ...overrides });

export const createFlashLoanConfig = (overrides: Partial<BotConfig> = {}): BotConfig =>
  createBotConfig({ useFlashLoans: true, flashLiquidatorContract: TEST_ADDRESSES.liquidator, ...overrides });

export const createDryRunConfig = (overrides: Partial<BotConfig> = {}): BotConfig =>
  createBotConfig({ dryRun: true, ...overrides });

export const createTestConfig = (overrides: Partial<BotConfig> = {}): BotConfig =>
  createBotConfig({ pollingIntervalMs: 100, maxGasPriceGwei: 5, ...overrides });

export const createExecutionConfig = (overrides: Partial<ExecutionConfig> = {}): ExecutionConfig => ({
  intervalMs: 1000,
  maxRetries: 3,
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 60000,
  successCooldownMs: 5000,
  ...overrides,
});

export const createCollateralSwapConfig = (overrides: Partial<CollateralSwapConfig> = {}): CollateralSwapConfig => ({
  strategy: CollateralStrategy.AUTO_SELL,
  targetStablecoins: [COMMON_TOKENS.USDT, COMMON_TOKENS.BUSD],
  tokenConfigs: DEFAULT_TOKEN_CONFIGS,
  maxSlippage: 0.05,
  maxPriceImpact: 0.1,
  minSwapAmountUsd: 10,
  ...overrides,
});

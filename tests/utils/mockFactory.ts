import { Address } from '../../src/types';
import { TEST_ADDRESSES, TEST_TOKENS, TEST_VTOKENS } from './testData';
import { MockComptroller } from '../mocks/MockComptroller';
import { MockPriceOracle } from '../mocks/MockPriceOracle';
import { MockLiquidator } from '../mocks/MockLiquidator';
import { MockVToken } from '../mocks/MockVToken';
import { MockPancakeRouter } from '../mocks/MockPancakeRouter';
import { MockPancakeFactory } from '../mocks/MockPancakeFactory';
import { MockPancakePool } from '../mocks/MockPancakePool';
import { MockProvider } from '../mocks/MockProvider';
import { MockSigner } from '../mocks/MockSigner';
import { MockPriceService } from '../mocks/MockPriceService';
import { MockERC20 } from '../mocks/MockERC20';
import { MockVenusContracts } from '../mocks/MockVenusContracts';
import MockSwapExecutor from '../mocks/MockSwapExecutor';
import MockPriceImpactChecker from '../mocks/MockPriceImpactChecker';
import MockRouteOptimizer from '../mocks/MockRouteOptimizer';
import MockStandardLiquidator from '../mocks/MockStandardLiquidator';
import MockFlashLoanLiquidator from '../mocks/MockFlashLoanLiquidator';
import MockProfitabilityCalculator from '../mocks/MockProfitabilityCalculator';
import MockTransactionBuilder from '../mocks/MockTransactionBuilder';
import MockRiskManager from '../mocks/MockRiskManager';
import MockCollateralManager from '../mocks/MockCollateralManager';
import MockLiquidationStrategy from '../mocks/MockLiquidationStrategy';
import { LiquidatablePosition, LiquidationMode, PositionTrackerStats, VenusPosition } from '../../src/types';
import MockHealthFactorCalculator from '../mocks/MockHealthFactorCalculator';
import MockPositionTracker from '../mocks/MockPositionTracker';
import MockEventMonitor from '../mocks/MockEventMonitor';
import MockPollingService from '../mocks/MockPollingService';

// Provider/Signer mocks are lightweight and do not extend ethers classes; cast to `any` when passing to services that expect them.
export const createMockVenusContracts = (options?: {
  comptroller?: MockComptroller;
  oracle?: MockPriceOracle;
  liquidator?: MockLiquidator;
  vTokens?: Map<Address, MockVToken>;
}) => {
  const comptroller = options?.comptroller ?? new MockComptroller();
  const oracle = options?.oracle ?? new MockPriceOracle();
  const liquidator = options?.liquidator ?? new MockLiquidator();

  const vTokens = options?.vTokens ?? new Map<Address, MockVToken>([
    [TEST_VTOKENS.vWBNB, new MockVToken({ symbol: 'vWBNB', underlying: TEST_TOKENS.WBNB })],
    [TEST_VTOKENS.vUSDT, new MockVToken({ symbol: 'vUSDT', underlying: TEST_TOKENS.USDT, decimals: 8 })],
  ]);

  comptroller.setOracleAddress(TEST_ADDRESSES.oracle);
  comptroller.setLiquidatorAddress(TEST_ADDRESSES.liquidator);
  comptroller.setMarkets(Array.from(vTokens.keys()));

  return {
    comptroller,
    oracle,
    liquidator,
    vTokens,
  };
};

export const createMockVenusContractsWrapper = (options?: {
  comptroller?: MockComptroller;
  oracle?: MockPriceOracle;
  liquidator?: MockLiquidator | null;
  vTokens?: Map<Address, MockVToken>;
}) => {
  const base = createMockVenusContracts({
    comptroller: options?.comptroller,
    oracle: options?.oracle,
    liquidator: options?.liquidator ?? undefined,
    vTokens: options?.vTokens,
  });

  const wrapper = new MockVenusContracts(base.comptroller, {
    oracle: options?.oracle ?? base.oracle,
    liquidator: options?.liquidator ?? base.liquidator,
    vTokens: options?.vTokens ?? base.vTokens,
  });

  return { wrapper, ...base };
};

export const createMockDexContracts = (options?: {
  router?: MockPancakeRouter;
  factory?: MockPancakeFactory;
  pools?: Map<Address, MockPancakePool>;
}) => {
  const router = options?.router ?? new MockPancakeRouter();
  const factory = options?.factory ?? new MockPancakeFactory();
  const pools = options?.pools ?? new Map<Address, MockPancakePool>([
    [TEST_ADDRESSES.poolLow, new MockPancakePool()],
    [TEST_ADDRESSES.poolMed, new MockPancakePool()],
  ]);

  factory.registerPool(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, 500, TEST_ADDRESSES.poolLow);
  factory.registerPool(TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, 2500, TEST_ADDRESSES.poolMed);

  return { router, factory, pools };
};

export const createMockProvider = (options?: {
  blockNumber?: number;
  gasPrice?: bigint;
  balances?: Record<Address, bigint>;
}) => {
  const provider = new MockProvider();
  if (options?.blockNumber !== undefined) provider.setBlockNumber(options.blockNumber);
  if (options?.gasPrice !== undefined) provider.setGasPrice(options.gasPrice);
  if (options?.balances) {
    Object.entries(options.balances).forEach(([address, bal]) => provider.setBalance(address, bal));
  }
  return provider;
};

export const createMockSigner = (options?: { address?: Address; provider?: MockProvider; balance?: bigint }) => {
  const signer = new MockSigner(options?.address);
  if (options?.provider) signer.connect(options.provider);
  if (options?.balance !== undefined) signer.setBalance(options.balance);
  return signer;
};

export const createMockPriceService = (options?: {
  prices?: Map<Address, number>;
  decimals?: Map<Address, number>;
}) => {
  const service = new MockPriceService();
  if (options?.prices) {
    options.prices.forEach((price, token) => service.setPrice(token, price));
  }
  if (options?.decimals) {
    options.decimals.forEach((decimals, token) => service.setDecimals(token, decimals));
  }
  return service;
};

export const createMockERC20 = (options?: {
  balances?: Record<Address, bigint>;
  allowances?: Record<Address, Record<Address, bigint>>;
  caller?: Address;
}) => {
  const token = new MockERC20();
  if (options?.caller) token.setCaller(options.caller);
  if (options?.balances) {
    Object.entries(options.balances).forEach(([address, bal]) => token.setBalance(address as Address, bal));
  }
  if (options?.allowances) {
    Object.entries(options.allowances).forEach(([owner, spenderMap]) => {
      Object.entries(spenderMap).forEach(([spender, amount]) => {
        const value = typeof amount === 'bigint' ? amount : BigInt(amount);
        token.setAllowance(owner as Address, spender as Address, value);
      });
    });
  }
  return token;
};

export const createFullMockEnvironment = (options?: {
  provider?: MockProvider;
  signer?: MockSigner;
  priceService?: MockPriceService;
}) => {
  const venus = createMockVenusContracts();
  const { wrapper: venusContracts } = createMockVenusContractsWrapper({
    comptroller: venus.comptroller,
    oracle: venus.oracle,
    liquidator: venus.liquidator,
    vTokens: venus.vTokens,
  });
  const dex = createMockDexContracts();
  const provider = options?.provider ?? createMockProvider();
  const signer = options?.signer ?? createMockSigner({ provider });
  const priceService = options?.priceService ?? createMockPriceService();

  return {
    venus,
    venusContracts,
    dex,
    provider,
    signer,
    priceService,
  };
};

export const createMockSwapExecutor = (options?: {
  success?: boolean;
  amountOut?: bigint;
  slippage?: number;
  priceImpact?: number;
  revert?: boolean;
}): MockSwapExecutor => {
  const executor = new MockSwapExecutor();
  if (options?.success !== undefined) executor.mockSwapResult(options.success, options.amountOut);
  if (options?.slippage !== undefined) executor.setSlippage(options.slippage);
  if (options?.priceImpact !== undefined) executor.setPriceImpact(options.priceImpact);
  if (options?.revert) executor.shouldRevert(true, 'Swap reverted');
  return executor;
};

export const createMockPriceImpactChecker = (options?: {
  impactPercent?: number;
  isAcceptable?: boolean;
  maxAllowedImpact?: number;
  prices?: Map<Address, number>;
}): MockPriceImpactChecker => {
  const checker = new MockPriceImpactChecker();
  if (options?.impactPercent !== undefined && options?.isAcceptable !== undefined) {
    checker.mockImpactCheck(options.impactPercent, options.isAcceptable);
  }
  if (options?.maxAllowedImpact !== undefined) checker.setMaxAllowedImpact(options.maxAllowedImpact);
  if (options?.prices) options.prices.forEach((p, token) => checker.mockTokenPrice(token, p));
  return checker;
};

export const createMockRouteOptimizer = (options?: {
  routes?: Map<string, { path: Address[]; fees: number[]; expectedOut: bigint }>;
  defaultRoute?: boolean;
}): MockRouteOptimizer => {
  const optimizer = new MockRouteOptimizer();
  options?.routes?.forEach((route, key) => optimizer.getRegisteredRoutes().set(key, route));
  if (options?.defaultRoute) {
    optimizer.mockDirectRoute(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, 500, 1_000n);
    optimizer.mockMultiHopRoute(TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT, [2_500, 500], 2_000n);
  }
  return optimizer;
};

export const createMockDexEnvironment = (options?: {
  router?: MockPancakeRouter;
  factory?: MockPancakeFactory;
  executor?: MockSwapExecutor;
  impactChecker?: MockPriceImpactChecker;
  optimizer?: MockRouteOptimizer;
  priceService?: MockPriceService;
}) => {
  const dexContracts = createMockDexContracts({ router: options?.router, factory: options?.factory });
  const executor = options?.executor ?? createMockSwapExecutor();
  const impactChecker = options?.impactChecker ?? createMockPriceImpactChecker();
  const optimizer = options?.optimizer ?? createMockRouteOptimizer();
  const priceService = options?.priceService ?? createMockPriceService();
  return { ...dexContracts, executor, impactChecker, optimizer, priceService };
};

export const createMockCollateralEnvironment = (options?: {
  strategy?: any;
  swapResult?: any;
  stats?: any;
}) => {
  const executor = createMockSwapExecutor({ success: true, amountOut: options?.swapResult?.amountOut ?? 1_000n });
  const impactChecker = createMockPriceImpactChecker();
  const optimizer = createMockRouteOptimizer({ defaultRoute: true });
  const priceService = createMockPriceService();
  const signer = createMockSigner();
  return { executor, impactChecker, optimizer, priceService, signer };
};

export const createMockStandardLiquidator = (options?: { result?: any }) => {
  const mock = new MockStandardLiquidator();
  if (options?.result) mock.mockExecutionResult(options.result);
  return mock;
};

export const createMockFlashLoanLiquidator = (options?: { result?: any; poolMissing?: boolean; contractMissing?: boolean }) => {
  const mock = new MockFlashLoanLiquidator();
  if (options?.result) mock.mockExecutionResult(options.result);
  if (options?.poolMissing) mock.mockPoolNotFound();
  if (options?.contractMissing) mock.mockContractNotFound();
  return mock;
};

export const createMockProfitabilityCalculator = (options?: { gasEstimate?: any; profitability?: any }) => {
  const mock = new MockProfitabilityCalculator();
  if (options?.gasEstimate) mock.mockGasEstimate(options.gasEstimate);
  if (options?.profitability) mock.mockProfitability(options.profitability);
  return mock;
};

export const createMockTransactionBuilder = (options?: { gasParams?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } }) => {
  const mock = new MockTransactionBuilder();
  if (options?.gasParams) mock.mockGasParams(options.gasParams);
  return mock;
};

export const createMockRiskManager = (options?: { validation?: any; emergency?: any; dailyStats?: any }) => {
  const mock = new MockRiskManager();
  if (options?.validation) mock.mockValidationResult(options.validation);
  if (options?.emergency) mock.mockEmergencyStop(options.emergency);
  if (options?.dailyStats) mock.mockDailyStats(options.dailyStats);
  return mock;
};

export const createMockCollateralManager = (options?: { swapResult?: any; stats?: any }) => {
  const mock = new MockCollateralManager();
  if (options?.swapResult !== undefined) mock.mockSwapResult(options.swapResult);
  if (options?.stats) mock.mockStats(options.stats);
  return mock;
};

export const createMockLiquidationStrategy = (options?: { mode?: LiquidationMode; valid?: boolean }) => {
  const mock = new MockLiquidationStrategy();
  if (options?.mode) mock.mockSelectedMode(options.mode);
  if (options?.valid !== undefined) mock.mockValidation(options.valid);
  return mock;
};

export const createMockHealthFactorCalculator = (options?: {
  defaultHealthFactor?: number;
  positions?: Map<Address, VenusPosition>;
  liquidationIncentive?: number;
}) => {
  const mock = new MockHealthFactorCalculator();
  if (options?.defaultHealthFactor !== undefined) mock.setDefaultHealthFactor(options.defaultHealthFactor);
  if (options?.positions) {
    options.positions.forEach((pos, account) => mock.setPosition(account, pos));
  }
  if (options?.liquidationIncentive !== undefined) mock.setLiquidationIncentive(options.liquidationIncentive);
  return mock;
};

export const createMockPositionTracker = (options?: {
  positions?: VenusPosition[];
  liquidatablePositions?: LiquidatablePosition[];
  stats?: PositionTrackerStats;
}) => {
  const mock = new MockPositionTracker();
  if (options?.positions) {
    options.positions.forEach((pos) => mock.addPosition(pos));
  }
  if (options?.liquidatablePositions) {
    options.liquidatablePositions.forEach((pos) => mock.addLiquidatablePosition(pos));
  }
  if (options?.stats) mock.setStats(options.stats);
  return mock;
};

export const createMockEventMonitor = (options?: { discoveredAccounts?: Address[]; eventsProcessed?: number }) => {
  const mock = new MockEventMonitor();
  if (options?.discoveredAccounts) {
    options.discoveredAccounts.forEach((acc) => mock.addDiscoveredAccount(acc));
  }
  if (options?.eventsProcessed !== undefined) mock.setEventsProcessed(options.eventsProcessed);
  return mock;
};

export const createMockPollingService = (options?: { accounts?: Address[]; stats?: { accountsTracked: number; lastPoll: number } }) => {
  const mock = new MockPollingService();
  if (options?.accounts) mock.setAccounts(options.accounts);
  if (options?.stats) mock.setStats(options.stats);
  return mock;
};

export const createMockMonitoringEnvironment = (overrides?: {
  healthFactorCalculator?: MockHealthFactorCalculator;
  positionTracker?: MockPositionTracker;
  eventMonitor?: MockEventMonitor;
  pollingService?: MockPollingService;
}) => {
  return {
    healthFactorCalculator: overrides?.healthFactorCalculator ?? createMockHealthFactorCalculator(),
    positionTracker: overrides?.positionTracker ?? createMockPositionTracker(),
    eventMonitor: overrides?.eventMonitor ?? createMockEventMonitor(),
    pollingService: overrides?.pollingService ?? createMockPollingService(),
  };
};

export const createMockLiquidationEngine = (overrides?: {
  strategy?: MockLiquidationStrategy;
  risk?: MockRiskManager;
  profit?: MockProfitabilityCalculator;
  txBuilder?: MockTransactionBuilder;
  std?: MockStandardLiquidator;
  flash?: MockFlashLoanLiquidator;
  collateral?: MockCollateralManager;
}) => {
  const strategy = overrides?.strategy ?? createMockLiquidationStrategy();
  const riskManager = overrides?.risk ?? createMockRiskManager();
  const profitability = overrides?.profit ?? createMockProfitabilityCalculator();
  const txBuilder = overrides?.txBuilder ?? createMockTransactionBuilder();
  const standardLiquidator = overrides?.std ?? createMockStandardLiquidator();
  const flashLiquidator = overrides?.flash ?? createMockFlashLoanLiquidator();
  const collateralManager = overrides?.collateral ?? createMockCollateralManager();

  return {
    strategy,
    riskManager,
    profitability,
    txBuilder,
    standardLiquidator,
    flashLiquidator,
    collateralManager,
  };
};

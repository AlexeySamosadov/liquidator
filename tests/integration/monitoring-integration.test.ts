import { parseUnits } from 'ethers';
import MonitoringService from '../../src/services/monitoring/MonitoringService';
import { createBotConfig } from '../utils/configFactory';
import { createMockVenusContractsWrapper, createMockPriceService, createMockEventMonitor } from '../utils/mockFactory';
import PositionTracker from '../../src/services/monitoring/PositionTracker';
import PollingService from '../../src/services/monitoring/PollingService';
import { DEFAULT_EXCHANGE_RATE, TEST_VTOKENS, TEST_ACCOUNTS, WBTC_DECIMALS, USDT_DECIMALS, MIN_POSITION_SIZE_USD } from '../utils/testData';
import { MockComptroller } from '../mocks/MockComptroller';
import { MockVToken } from '../mocks/MockVToken';
import { MockPriceOracle } from '../mocks/MockPriceOracle';
import { expectHealthFactorValid, expectLiquidatablePositionValid, expectMonitoringStats } from '../utils/assertions';

const provider: any = { getNetwork: jest.fn(async () => ({ chainId: 56 })) };

const seedAccount = (
  account: string,
  opts: {
    comptroller: MockComptroller;
    vToken: MockVToken;
    oracle: MockPriceOracle;
    liquidity: number;
    shortfall: number;
    borrowUsd: number;
  },
) => {
  const { comptroller, vToken, oracle, liquidity, shortfall, borrowUsd } = opts;
  comptroller.setAssetsIn(account as any, [TEST_VTOKENS.vUSDT]);
  comptroller.setAccountLiquidity(account as any, {
    error: 0n,
    liquidity: parseUnits(liquidity.toString(), 18),
    shortfall: parseUnits(shortfall.toString(), 18),
  });
  vToken.setAccountSnapshot(account as any, {
    error: 0n,
    vTokenBalance: 0n,
    borrowBalance: parseUnits(borrowUsd.toString(), 18),
    exchangeRate: DEFAULT_EXCHANGE_RATE,
  });
  oracle.setPriceUsd(TEST_VTOKENS.vUSDT, 1, 18);
};

describe('Monitoring integration', () => {
  const buildService = async (options?: {
    vTokens?: Map<string, MockVToken>;
    comptroller?: MockComptroller;
    oracle?: MockPriceOracle;
    configOverrides?: Partial<ReturnType<typeof createBotConfig>>;
  }) => {
    const comptroller = options?.comptroller ?? new MockComptroller();
    const oracle = options?.oracle ?? new MockPriceOracle();
    const baseVTokens = new Map();
    const vUSDT = new MockVToken({ underlying: TEST_VTOKENS.vUSDT, exchangeRate: DEFAULT_EXCHANGE_RATE, symbol: 'vUSDT', decimals: 18 });
    baseVTokens.set(TEST_VTOKENS.vUSDT, vUSDT as any);
    const vTokens = options?.vTokens ?? baseVTokens;
    comptroller.setMarkets(Array.from(vTokens.keys()));
    const { wrapper } = createMockVenusContractsWrapper({ comptroller, oracle, vTokens });
    const config = createBotConfig({ pollingIntervalMs: 10, minHealthFactor: 1.05, minPositionSizeUsd: 100, ...options?.configOverrides });
    const priceService = createMockPriceService();

    const service = new MonitoringService(wrapper as any, provider as any, config, priceService as any) as any;
    await service.initialize();

    // Override profitability to avoid network calls
    service.profitabilityCalculator = { estimateGasCostUsdForCandidate: async () => 0.1 };
    service.positionTracker = new PositionTracker(service.healthFactorCalculator, priceService as any, config.minHealthFactor, config.minPositionSizeUsd, async () => 0.1);
    service.pollingService = new PollingService(
      service.healthFactorCalculator,
      config.pollingIntervalMs,
      config.minHealthFactor,
      (pos) => service.positionTracker.updatePosition(pos),
      config.healthyPollsBeforeDrop,
    );
    const eventMonitor = createMockEventMonitor();
    eventMonitor.setOnAccountDiscovered((account) => service.pollingService.addAccount(account));
    service.eventMonitor = eventMonitor;

    return { service, comptroller, oracle, vUSDT: vTokens.get(TEST_VTOKENS.vUSDT) as MockVToken, config, vTokens };
  };

  test('full discovery → polling → liquidatable flow', async () => {
    const { service, comptroller, oracle, vUSDT } = await buildService();
    seedAccount(TEST_ACCOUNTS[0], { comptroller, vToken: vUSDT, oracle, liquidity: 200, shortfall: 800, borrowUsd: 10_000 });
    seedAccount(TEST_ACCOUNTS[1], { comptroller, vToken: vUSDT, oracle, liquidity: 2_000, shortfall: 0, borrowUsd: 1_000 });

    service.eventMonitor.addDiscoveredAccount(TEST_ACCOUNTS[0]);
    service.eventMonitor.addDiscoveredAccount(TEST_ACCOUNTS[1]);

    await service.start();
    service.pollingService.addAccounts([TEST_ACCOUNTS[0], TEST_ACCOUNTS[1]]);
    await service.pollingService.poll();

    const liquidatables = service.getLiquidatablePositions();
    expect(liquidatables.length).toBe(1);
    expectLiquidatablePositionValid(liquidatables[0]);
    expectHealthFactorValid(liquidatables[0].healthFactor);

    const stats = service.getStats();
    expectMonitoringStats(stats, { totalAccountsTracked: 2, liquidatablePositions: 1 });
    service.stop();
  });

  test('position recovers and is removed from liquidatable set', async () => {
    const { service, comptroller, oracle, vUSDT } = await buildService();
    seedAccount(TEST_ACCOUNTS[0], { comptroller, vToken: vUSDT, oracle, liquidity: 100, shortfall: 500, borrowUsd: 5_000 });
    service.pollingService.addAccount(TEST_ACCOUNTS[0]);
    await service.pollingService.poll();
    expect(service.getLiquidatablePositions().length).toBe(1);

    seedAccount(TEST_ACCOUNTS[0], { comptroller, vToken: vUSDT, oracle, liquidity: 5_000, shortfall: 0, borrowUsd: 2_000 });
    await service.pollingService.poll();

    expect(service.getLiquidatablePositions().length).toBe(0);
    service.stop();
  });

  test('multiple liquidatable positions are sorted by profit', async () => {
    const { service, comptroller, oracle, vUSDT } = await buildService();
    seedAccount(TEST_ACCOUNTS[0], { comptroller, vToken: vUSDT, oracle, liquidity: 50, shortfall: 950, borrowUsd: 2_000 });
    seedAccount(TEST_ACCOUNTS[1], { comptroller, vToken: vUSDT, oracle, liquidity: 10, shortfall: 990, borrowUsd: 10_000 });
    seedAccount(TEST_ACCOUNTS[2], { comptroller, vToken: vUSDT, oracle, liquidity: 5, shortfall: 995, borrowUsd: 500 });

    service.pollingService.addAccounts(TEST_ACCOUNTS);
    await service.pollingService.poll();

    const positions = service.getLiquidatablePositions();
    expect(positions.length).toBe(3);
    expect(positions[0].debtValueUsd).toBeGreaterThanOrEqual(positions[1].debtValueUsd);
    expect(positions[1].debtValueUsd).toBeGreaterThanOrEqual(positions[2].debtValueUsd);
    service.stop();
  });

  test('categorizes healthy, liquidatable, and neutral accounts correctly', async () => {
    const { service, comptroller, oracle, vUSDT } = await buildService();
    seedAccount(TEST_ACCOUNTS[0], { comptroller, vToken: vUSDT, oracle, liquidity: 5_000, shortfall: 0, borrowUsd: 500 });
    seedAccount(TEST_ACCOUNTS[1], { comptroller, vToken: vUSDT, oracle, liquidity: 100, shortfall: 500, borrowUsd: 2_000 });
    seedAccount(TEST_ACCOUNTS[2], { comptroller, vToken: vUSDT, oracle, liquidity: 0, shortfall: 0, borrowUsd: 1_000 });

    service.pollingService.addAccounts(TEST_ACCOUNTS);
    await service.pollingService.poll();

    const liquidatables = service.getLiquidatablePositions();
    expect(liquidatables.map((p) => p.borrower.toLowerCase())).toContain(TEST_ACCOUNTS[1].toLowerCase());
    expect(liquidatables.length).toBe(1);

    const healthy = (service as any).positionTracker.getPosition(TEST_ACCOUNTS[0]);
    const neutral = (service as any).positionTracker.getPosition(TEST_ACCOUNTS[2]);
    expect(healthy?.healthFactor).toBe(Number.POSITIVE_INFINITY);
    expect(neutral?.healthFactor).toBeCloseTo(1.0, 5);
    service.stop();
  });

  test('ignores markets with snapshot errors or zero prices while keeping position valid', async () => {
    const comptroller = new MockComptroller();
    const oracle = new MockPriceOracle();
    const vUSDT = new MockVToken({ underlying: TEST_VTOKENS.vUSDT, exchangeRate: DEFAULT_EXCHANGE_RATE, symbol: 'vUSDT', decimals: 18 });
    const vWBNB = new MockVToken({ underlying: TEST_VTOKENS.vWBNB, exchangeRate: DEFAULT_EXCHANGE_RATE, symbol: 'vWBNB', decimals: 18 });
    const vUSDC = new MockVToken({ underlying: TEST_VTOKENS.vUSDC, exchangeRate: DEFAULT_EXCHANGE_RATE, symbol: 'vUSDC', decimals: 18 });
    const vTokens = new Map();
    vTokens.set(TEST_VTOKENS.vUSDT, vUSDT as any);
    vTokens.set(TEST_VTOKENS.vWBNB, vWBNB as any);
    vTokens.set(TEST_VTOKENS.vUSDC, vUSDC as any);

    const { service } = await buildService({ comptroller, oracle, vTokens });

    comptroller.setAssetsIn(TEST_ACCOUNTS[0], [TEST_VTOKENS.vUSDT, TEST_VTOKENS.vWBNB, TEST_VTOKENS.vUSDC]);
    comptroller.setAccountLiquidity(TEST_ACCOUNTS[0], { error: 0n, liquidity: parseUnits('10', 18), shortfall: parseUnits('5', 18) });

    vUSDT.setAccountSnapshot(TEST_ACCOUNTS[0], {
      error: 1n,
      vTokenBalance: 0n,
      borrowBalance: 0n,
      exchangeRate: DEFAULT_EXCHANGE_RATE,
    });
    oracle.setPriceUsd(TEST_VTOKENS.vWBNB, 0, 18);
    vWBNB.setAccountSnapshot(TEST_ACCOUNTS[0], {
      error: 0n,
      vTokenBalance: parseUnits('1', 18),
      borrowBalance: parseUnits('0.5', 18),
      exchangeRate: DEFAULT_EXCHANGE_RATE,
    });
    oracle.setPriceUsd(TEST_VTOKENS.vUSDC, 1, 18);
    vUSDC.setAccountSnapshot(TEST_ACCOUNTS[0], {
      error: 0n,
      vTokenBalance: parseUnits('100', 18),
      borrowBalance: parseUnits('50', 18),
      exchangeRate: DEFAULT_EXCHANGE_RATE,
    });

    service.pollingService.addAccount(TEST_ACCOUNTS[0]);
    await service.pollingService.poll();

    const position = (service as any).positionTracker.getPosition(TEST_ACCOUNTS[0]);
    expect(position).toBeDefined();
    expect(position?.borrowTokens).toContain(TEST_VTOKENS.vUSDC);
    expect(position?.borrowTokens).not.toContain(TEST_VTOKENS.vUSDT);
    service.stop();
  });

  test('handles mixed decimal markets and aggregates USD values', async () => {
    const comptroller = new MockComptroller();
    const oracle = new MockPriceOracle();
    const vUSDT = new MockVToken({ underlying: TEST_VTOKENS.vUSDT, exchangeRate: DEFAULT_EXCHANGE_RATE, symbol: 'vUSDT', decimals: USDT_DECIMALS });
    const vWBTC = new MockVToken({ underlying: TEST_VTOKENS.vBTCB, exchangeRate: DEFAULT_EXCHANGE_RATE, symbol: 'vWBTC', decimals: WBTC_DECIMALS });
    const vTokens = new Map();
    vTokens.set(TEST_VTOKENS.vUSDT, vUSDT as any);
    vTokens.set(TEST_VTOKENS.vBTCB, vWBTC as any);

    const { service } = await buildService({ comptroller, oracle, vTokens });

    comptroller.setAssetsIn(TEST_ACCOUNTS[1], [TEST_VTOKENS.vUSDT, TEST_VTOKENS.vBTCB]);
    comptroller.setAccountLiquidity(TEST_ACCOUNTS[1], { error: 0n, liquidity: parseUnits('50', 18), shortfall: parseUnits('100', 18) });

    oracle.setPriceUsd(TEST_VTOKENS.vUSDT, 1, USDT_DECIMALS);
    oracle.setPriceUsd(TEST_VTOKENS.vBTCB, 30000, WBTC_DECIMALS);

    vUSDT.setAccountSnapshot(TEST_ACCOUNTS[1], {
      error: 0n,
      vTokenBalance: 0n,
      borrowBalance: 100_000_000n,
      exchangeRate: DEFAULT_EXCHANGE_RATE,
    });

    vWBTC.setAccountSnapshot(TEST_ACCOUNTS[1], {
      error: 0n,
      vTokenBalance: parseUnits('0.01', 18),
      borrowBalance: 10_000_000n,
      exchangeRate: DEFAULT_EXCHANGE_RATE,
    });

    service.pollingService.addAccount(TEST_ACCOUNTS[1]);
    await service.pollingService.poll();

    const liquidatables = service.getLiquidatablePositions();
    expect(liquidatables.length).toBeGreaterThan(0);
    const stats = service.getStats();
    expect(stats.totalAccountsTracked).toBeGreaterThan(0);
    expect(stats.liquidatablePositions).toBeGreaterThan(0);
    service.stop();
  });

  test('drops healthy zero-debt accounts after configured healthy polls', async () => {
    const { service, comptroller, oracle, vUSDT, config } = await buildService({
      configOverrides: { healthyPollsBeforeDrop: 2 },
    });
    comptroller.setAssetsIn(TEST_ACCOUNTS[0], [TEST_VTOKENS.vUSDT]);
    comptroller.setAccountLiquidity(TEST_ACCOUNTS[0], { error: 0n, liquidity: parseUnits('1000', 18), shortfall: 0n });
    vUSDT.setAccountSnapshot(TEST_ACCOUNTS[0], {
      error: 0n,
      vTokenBalance: parseUnits('10', 18),
      borrowBalance: 0n,
      exchangeRate: DEFAULT_EXCHANGE_RATE,
    });
    oracle.setPriceUsd(TEST_VTOKENS.vUSDT, 1, 18);

    service.pollingService.addAccount(TEST_ACCOUNTS[0]);
    await service.pollingService.poll();
    await service.pollingService.poll();
    await service.pollingService.poll();

    const pollingStats = service.pollingService.getStats();
    expect(pollingStats.accountsTracked).toBe(0);
    const stats = service.getStats();
    expect(stats.totalAccountsTracked).toBe(0);
    service.stop();
  });

  test('respects minPositionSizeUsd when evaluating liquidatable accounts', async () => {
    const { service, comptroller, oracle, vUSDT } = await buildService({ configOverrides: { minPositionSizeUsd: MIN_POSITION_SIZE_USD } });
    comptroller.setAssetsIn(TEST_ACCOUNTS[2], [TEST_VTOKENS.vUSDT]);
    comptroller.setAccountLiquidity(TEST_ACCOUNTS[2], { error: 0n, liquidity: parseUnits('1', 18), shortfall: parseUnits('2', 18) });
    oracle.setPriceUsd(TEST_VTOKENS.vUSDT, 1, 18);
    vUSDT.setAccountSnapshot(TEST_ACCOUNTS[2], {
      error: 0n,
      vTokenBalance: 0n,
      borrowBalance: parseUnits('0.001', 18),
      exchangeRate: DEFAULT_EXCHANGE_RATE,
    });

    service.pollingService.addAccount(TEST_ACCOUNTS[2]);
    await service.pollingService.poll();

    expect(service.getLiquidatablePositions().length).toBe(0);
    service.stop();
  });
});

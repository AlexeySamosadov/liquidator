import MonitoringService from '../../src/services/monitoring/MonitoringService';
import { createBotConfig } from '../utils/configFactory';
import {
  createMockHealthFactorCalculator,
  createMockPositionTracker,
  createMockEventMonitor,
  createMockPollingService,
  createMockVenusContractsWrapper,
  createMockPriceService,
} from '../utils/mockFactory';
import { createVenusPosition } from '../utils/positionFactory';
import { expectMonitoringStats } from '../utils/assertions';

const buildServiceWithMocks = async () => {
  const config = createBotConfig({ pollingIntervalMs: 50, minHealthFactor: 1.05, minPositionSizeUsd: 100 });
  const { wrapper } = createMockVenusContractsWrapper();
  const provider: any = { getNetwork: jest.fn(async () => ({ chainId: 56 })) };
  const priceService = createMockPriceService();

  const service = new MonitoringService(wrapper as any, provider as any, config, priceService as any) as any;
  await service.initialize();

  const healthFactorCalculator = createMockHealthFactorCalculator();
  const positionTracker = createMockPositionTracker();
  const pollingService = createMockPollingService();
  const eventMonitor = createMockEventMonitor();

  eventMonitor.setOnAccountDiscovered((account) => pollingService.addAccount(account));
  pollingService.setOnPositionUpdate(async (position) => positionTracker.updatePosition(position));

  service.healthFactorCalculator = healthFactorCalculator;
  service.positionTracker = positionTracker;
  service.pollingService = pollingService;
  service.eventMonitor = eventMonitor;

  return { service, healthFactorCalculator, positionTracker, pollingService, eventMonitor, config };
};

describe('MonitoringService', () => {
  test('initialize wires subservices', async () => {
    const { service } = await buildServiceWithMocks();
    expect(service.healthFactorCalculator).toBeDefined();
    expect(service.positionTracker).toBeDefined();
    expect(service.pollingService).toBeDefined();
    expect(service.eventMonitor).toBeDefined();
  });

  test('start and stop toggle lifecycle', async () => {
    const { service, eventMonitor, pollingService } = await buildServiceWithMocks();

    await service.start();
    expect(service.isActive()).toBe(true);
    expect(eventMonitor.getStartCallCount()).toBe(1);
    expect(pollingService.getStartCallCount()).toBe(1);

    service.stop();
    expect(service.isActive()).toBe(false);
    expect(eventMonitor.getStopCallCount()).toBe(1);
    expect(pollingService.getStopCallCount()).toBe(1);
  });

  test('start is idempotent and does not double-start subservices', async () => {
    const { service, eventMonitor, pollingService } = await buildServiceWithMocks();

    await service.start();
    await service.start();

    expect(service.isActive()).toBe(true);
    expect(eventMonitor.getStartCallCount()).toBe(1);
    expect(pollingService.getStartCallCount()).toBe(1);
  });

  test('stop is idempotent after successful start', async () => {
    const { service, eventMonitor, pollingService } = await buildServiceWithMocks();

    await service.start();
    service.stop();
    service.stop();

    expect(service.isActive()).toBe(false);
    expect(eventMonitor.getStopCallCount()).toBe(1);
    expect(pollingService.getStopCallCount()).toBe(1);
  });

  test('propagates polling start errors and stays inactive', async () => {
    const { service, pollingService } = await buildServiceWithMocks();
    jest.spyOn(pollingService as any, 'start').mockImplementation(() => {
      throw new Error('polling start failure');
    });

    await expect(service.start()).rejects.toThrow('polling start failure');
    expect(service.isActive()).toBe(false);
  });

  test('getLiquidatablePositions proxies to tracker', async () => {
    const { service, positionTracker } = await buildServiceWithMocks();
    const position = createVenusPosition({ healthFactor: 0.8, debtValueUsd: 1_000 });
    await positionTracker.updatePosition(position as any);

    const result = service.getLiquidatablePositions();

    expect(result.length).toBe(1);
    expect(result[0].borrower.toLowerCase()).toBe(position.borrower.toLowerCase());
  });

  test('getStats aggregates tracker, polling and events', async () => {
    const { service, positionTracker, pollingService, eventMonitor } = await buildServiceWithMocks();
    await positionTracker.updatePosition(createVenusPosition({ healthFactor: 0.9, debtValueUsd: 2_000 }) as any);
    pollingService.setStats({ accountsTracked: 1, lastPoll: Date.now() });
    eventMonitor.setEventsProcessed(3);

    const stats = service.getStats();

    expectMonitoringStats(stats, {
      totalAccountsTracked: 1,
      liquidatablePositions: 1,
      eventsProcessed: 3,
    });
  });

  test('event discovery flows into polling', async () => {
    const { service, eventMonitor, pollingService } = await buildServiceWithMocks();
    eventMonitor.addDiscoveredAccount('0x123');

    await service.start();
    await pollingService.poll();

    expect(pollingService.getAddAccountHistory().length).toBeGreaterThan(0);
    service.stop();
  });

  test('propagates subservice start errors', async () => {
    const { service, eventMonitor } = await buildServiceWithMocks();
    eventMonitor.mockStartError();

    await expect(service.start()).rejects.toThrow('Mock start error');
  });
});

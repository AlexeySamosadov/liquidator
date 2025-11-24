import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import RouteOptimizer from '../../src/services/dex/RouteOptimizer';
import { COMMON_TOKENS, PANCAKE_FEE_TIERS } from '../../src/config/tokens';
import { TEST_ADDRESSES, TEST_TOKENS } from '../utils/testData';
import { MockPancakeFactory } from '../mocks/MockPancakeFactory';
import { MockPancakePool } from '../mocks/MockPancakePool';
import { MockSwapExecutor } from '../mocks/MockSwapExecutor';

const buildOptimizer = () => {
  const provider: any = {};
  const optimizer = new RouteOptimizer(provider, TEST_ADDRESSES.factory, undefined, undefined as any);
  return optimizer as any;
};

describe('RouteOptimizer', () => {
  it('returns direct route when pool exists', async () => {
    const optimizer = buildOptimizer();
    optimizer.factory = { getPool: jest.fn().mockResolvedValue(TEST_ADDRESSES.poolLow) };
    optimizer.estimateMultiHopOutput = jest.fn().mockResolvedValue(1000n);

    const route = await optimizer.findBestRoute(TEST_TOKENS.WBNB, TEST_TOKENS.USDT, 1_000n);
    expect(route.path).toEqual([TEST_TOKENS.WBNB, TEST_TOKENS.USDT]);
    expect(route.expectedOut).toBe(1000n);
  });

  it('falls back to multi-hop via intermediary', async () => {
    const optimizer = buildOptimizer();
    optimizer.factory = {
      getPool: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(TEST_ADDRESSES.poolLow)
        .mockResolvedValueOnce(TEST_ADDRESSES.poolMed)
        .mockResolvedValue(TEST_ADDRESSES.poolMed),
    };
    optimizer.selectBestFee = jest.fn().mockResolvedValue(500);
    optimizer.estimateMultiHopOutput = jest.fn().mockResolvedValue(800n);

    const route = await optimizer.findBestRoute(TEST_TOKENS.BTCB, TEST_TOKENS.USDT, 1_000n);
    expect(route.path.length).toBe(3);
    expect(route.path[1]).toBe(COMMON_TOKENS.WBNB);
    expect(route.expectedOut).toBe(800n);
  });

  it('returns empty route when no pools found', async () => {
    const optimizer = buildOptimizer();
    optimizer.factory = { getPool: jest.fn().mockResolvedValue(null) };
    optimizer.selectBestFee = jest.fn().mockResolvedValue(null);
    optimizer.estimateMultiHopOutput = jest.fn().mockResolvedValue(0n);

    const route = await optimizer.findBestRoute(TEST_TOKENS.BUSD, TEST_TOKENS.USDC, 1_000n);
    expect(route.path).toEqual([]);
    expect(route.expectedOut).toBe(0n);
  });

  it('estimateMultiHopOutput returns 0 for invalid path', async () => {
    const optimizer = buildOptimizer();
    const out = await optimizer.estimateMultiHopOutput([TEST_TOKENS.WBNB], [], 1000n);
    expect(out).toBe(0n);
  });
});

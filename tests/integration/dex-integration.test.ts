import { describe, expect, it, jest } from '@jest/globals';
import { parseUnits } from 'ethers';
import CollateralManager from '../../src/services/dex/CollateralManager';
import SwapExecutor from '../../src/services/dex/SwapExecutor';
import PriceImpactChecker from '../../src/services/dex/PriceImpactChecker';
import RouteOptimizer from '../../src/services/dex/RouteOptimizer';
import { createBotConfig, createCollateralSwapConfig } from '../utils/configFactory';
import { createMockProvider, createMockSigner, createMockDexContracts, createMockPriceService } from '../utils/mockFactory';
import { TEST_ADDRESSES, TEST_TOKENS } from '../utils/testData';

describe('DEX Integration Tests', () => {
  it('runs end-to-end auto sell flow for WBNB collateral', async () => {
    const provider = createMockProvider();
    const signer = createMockSigner({ provider });
    const { router, factory } = createMockDexContracts();
    router.connect = () => router;
    router.target = TEST_ADDRESSES.router;
    router.callStatic = { exactInputSingle: async () => parseUnits('300', 6), exactInput: async () => parseUnits('300', 6) };
    const priceService = createMockPriceService();

    const config = createBotConfig({ collateralStrategy: 'AUTO_SELL' as any, slippageTolerance: 0.01 });
    const swapExecutor = new SwapExecutor(router as any, signer as any, config);
    const impactChecker = new PriceImpactChecker(config, priceService as any);
    const optimizer = new RouteOptimizer(provider as any, TEST_ADDRESSES.factory, TEST_ADDRESSES.router, swapExecutor as any);
    // stub internals to avoid on-chain calls
    (optimizer as any).factory = { getPool: async () => TEST_ADDRESSES.poolLow };
    jest.spyOn(optimizer as any, 'estimateMultiHopOutput').mockResolvedValue(parseUnits('300', 6));

    const collateralConfig = createCollateralSwapConfig({ strategy: 'AUTO_SELL' as any, targetStablecoins: [TEST_TOKENS.USDT] });
    const manager = new CollateralManager(swapExecutor as any, impactChecker as any, optimizer as any, config, signer as any, collateralConfig);

    const res = await manager.handleCollateral(TEST_TOKENS.WBNB, parseUnits('1', 18), { success: true } as any);
    expect(res?.success).toBe(true);
    expect(res?.tokenOut).toBe(TEST_TOKENS.USDT);
  });
});

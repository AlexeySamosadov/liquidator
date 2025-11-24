import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  createFullMockEnvironment,
  createLiquidatablePosition,
  createBotConfig,
  expectLiquidationSuccess,
  TEST_TOKENS,
} from '../utils';

describe('Example Test Suite', () => {
  let mockEnv: ReturnType<typeof createFullMockEnvironment>;
  let config: ReturnType<typeof createBotConfig>;

  beforeEach(() => {
    mockEnv = createFullMockEnvironment();
    config = createBotConfig();
  });

  test('should demonstrate mock usage', async () => {
    expect(config.minProfitUsd).toBeGreaterThan(0);

    const position = createLiquidatablePosition({
      repayToken: TEST_TOKENS.USDT,
      seizeToken: TEST_TOKENS.WBNB,
    });

    mockEnv.venus.comptroller.setAccountLiquidity(position.borrower, position.accountLiquidity);

    expect(position.healthFactor).toBeLessThan(1.0);
  });

  test('should demonstrate assertion helpers', async () => {
    const result = {
      success: true,
      txHash: '0x123',
      profitUsd: 50,
      gasUsd: 5,
      repayAmount: 1n,
      seizeAmount: 1n,
    };

    expectLiquidationSuccess(result, 50);
  });
});

import { parseUnits } from 'ethers';
import LiquidationStrategy from '../../src/services/liquidation/LiquidationStrategy';
import { LiquidationMode } from '../../src/types';
import {
  createBotConfig,
  createFlashLoanConfig,
  createLiquidatablePosition,
  createMockProfitabilityCalculator,
  createMockProvider,
  createMockSigner,
  createMockVenusContractsWrapper,
  TEST_VTOKENS,
} from '../utils';

// Helper to build strategy with mocks
const buildStrategy = (options: { useFlashLoans?: boolean; walletBalance?: bigint } = {}) => {
  const config = options.useFlashLoans ? createFlashLoanConfig() : createBotConfig({ useFlashLoans: false });
  const { wrapper: venusContracts } = createMockVenusContractsWrapper();
  (venusContracts as any).getVToken(TEST_VTOKENS.vUSDT).setUnderlying(null);
  const signer: any = createMockSigner();
  signer.address = '0xsigner000000000000000000000000000000000001';
  const provider = createMockProvider({ balances: { [signer.address]: options.walletBalance ?? parseUnits('1000', 18) } });
  signer.provider = provider as any;
  const profitability = createMockProfitabilityCalculator();

  return { strategy: new LiquidationStrategy(venusContracts as any, signer, config, profitability as any), profitability, config, signer };
};

describe('LiquidationStrategy', () => {
  test('selectStrategy returns STANDARD when flash loans disabled', async () => {
    const { strategy } = buildStrategy({ useFlashLoans: false });
    const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT });
    const mode = await strategy.selectStrategy(position);
    expect(mode).toBe(LiquidationMode.STANDARD);
  });

  test('selectStrategy chooses FLASH_LOAN when wallet balance insufficient but flash configured', async () => {
    const { strategy } = buildStrategy({ useFlashLoans: true, walletBalance: 0n });
    const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseUnits('1000', 18) });
    const mode = await strategy.selectStrategy(position);
    expect(mode).toBe(LiquidationMode.FLASH_LOAN);
  });

  test('selectStrategy compares profitability and picks better mode', async () => {
    const { strategy, profitability } = buildStrategy({ useFlashLoans: true, walletBalance: parseUnits('2000', 18) });
    profitability.mockProfitability({
      grossProfitUsd: 50,
      gasCostUsd: 10,
      flashLoanFeeUsd: 0,
      netProfitUsd: 40,
      profitMargin: 0.8,
      isProfitable: true,
      recommendedMode: LiquidationMode.STANDARD,
    });
    const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, estimatedProfitUsd: 80 });
    const mode = await strategy.selectStrategy(position);
    expect(mode).toBe(LiquidationMode.STANDARD);
  });

  test('validateStrategy standard mode requires enough balance and min profit', async () => {
    const { strategy } = buildStrategy({ useFlashLoans: false, walletBalance: parseUnits('100', 18) });
    const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseUnits('50', 18), estimatedProfitUsd: 20 });
    const valid = await strategy.validateStrategy(position, LiquidationMode.STANDARD);
    expect(valid).toBe(true);
  });

  test('validateStrategy flash mode fails when contract missing', async () => {
    const config = createBotConfig({ useFlashLoans: true, flashLiquidatorContract: undefined });
    const { wrapper: venusContracts } = createMockVenusContractsWrapper();
    (venusContracts as any).getVToken(TEST_VTOKENS.vUSDT).setUnderlying(null);
    const provider = createMockProvider();
    const signer: any = createMockSigner({ provider });
    signer.provider = provider as any;
    const profitability = createMockProfitabilityCalculator();
    const strategy = new LiquidationStrategy(venusContracts as any, signer, config, profitability as any);

    const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, estimatedProfitUsd: 50 });
    const valid = await strategy.validateStrategy(position, LiquidationMode.FLASH_LOAN);
    expect(valid).toBe(false);
  });

  test('selectStrategy throws when insufficient balance and flash not available', async () => {
    const config = createBotConfig({ useFlashLoans: true, flashLiquidatorContract: undefined });
    const { wrapper: venusContracts } = createMockVenusContractsWrapper();
    (venusContracts as any).getVToken(TEST_VTOKENS.vUSDT).setUnderlying(null);
    const provider = createMockProvider({ balances: { ['0xsigner']: 0n } });
    const signer: any = createMockSigner({ provider });
    signer.address = '0xsigner';
    signer.provider = provider as any;
    const profitability = createMockProfitabilityCalculator();
    const strategy = new LiquidationStrategy(venusContracts as any, signer, config, profitability as any);
    const position = createLiquidatablePosition({ repayToken: TEST_VTOKENS.vUSDT, repayAmount: parseUnits('10', 18) });
    await expect(strategy.selectStrategy(position)).rejects.toThrow('Insufficient balance');
  });
});

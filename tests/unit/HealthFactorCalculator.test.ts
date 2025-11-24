import HealthFactorCalculator from '../../src/services/monitoring/HealthFactorCalculator';
import { createMockVenusContractsWrapper } from '../utils/mockFactory';
import { MockComptroller } from '../mocks/MockComptroller';
import { MockVToken } from '../mocks/MockVToken';
import { MockPriceOracle } from '../mocks/MockPriceOracle';
import { TEST_VTOKENS, TEST_ACCOUNTS, DEFAULT_LIQUIDATION_INCENTIVE, HEALTHY_LIQUIDITY, SMALL_SHORTFALL, LARGE_SHORTFALL, DEFAULT_EXCHANGE_RATE } from '../utils/testData';
import { parseUnits } from 'ethers';
import { expectAccountLiquidityValid, expectHealthFactorLiquidatable, expectHealthFactorValid, expectPositionDetailsValid } from '../utils/assertions';
import { createVenusPosition } from '../utils/positionFactory';

const buildCalculator = () => {
  const comptroller = new MockComptroller();
  const oracle = new MockPriceOracle();
  const vWBNB = new MockVToken({ underlying: TEST_VTOKENS.vWBNB, exchangeRate: DEFAULT_EXCHANGE_RATE, symbol: 'vWBNB', decimals: 8 });
  const vUSDT = new MockVToken({ underlying: TEST_VTOKENS.vUSDT, exchangeRate: DEFAULT_EXCHANGE_RATE, symbol: 'vUSDT', decimals: 8 });

  const vTokens = new Map();
  vTokens.set(TEST_VTOKENS.vWBNB, vWBNB as any);
  vTokens.set(TEST_VTOKENS.vUSDT, vUSDT as any);

  comptroller.setMarkets([TEST_VTOKENS.vWBNB, TEST_VTOKENS.vUSDT]);
  oracle.setPriceUsd(TEST_VTOKENS.vWBNB, 300, 18);
  oracle.setPriceUsd(TEST_VTOKENS.vUSDT, 1, 6);

  const { wrapper } = createMockVenusContractsWrapper({ comptroller, oracle, vTokens });
  const calculator = new HealthFactorCalculator(wrapper as any);

  return { calculator, comptroller, oracle, vTokens, vWBNB, vUSDT };
};

describe('HealthFactorCalculator', () => {
  describe('calculateHealthFactor', () => {
    test('returns Infinity for healthy liquidity and zero shortfall', async () => {
      const { calculator, comptroller } = buildCalculator();
      comptroller.setAccountLiquidity(TEST_ACCOUNTS[0], { error: 0n, liquidity: HEALTHY_LIQUIDITY, shortfall: 0n });

      const hf = await calculator.calculateHealthFactor(TEST_ACCOUNTS[0]);

      expect(hf).toBe(Number.POSITIVE_INFINITY);
    });

    test('returns ratio when shortfall > 0', async () => {
      const { calculator, comptroller } = buildCalculator();
      comptroller.setAccountLiquidity(TEST_ACCOUNTS[0], { error: 0n, liquidity: HEALTHY_LIQUIDITY, shortfall: SMALL_SHORTFALL });

      const hf = await calculator.calculateHealthFactor(TEST_ACCOUNTS[0]);

      expectHealthFactorLiquidatable(hf);
    });

    test('returns 1.0 when liquidity and shortfall are zero', async () => {
      const { calculator, comptroller } = buildCalculator();
      comptroller.setAccountLiquidity(TEST_ACCOUNTS[0], { error: 0n, liquidity: 0n, shortfall: 0n });

      const hf = await calculator.calculateHealthFactor(TEST_ACCOUNTS[0]);

      expect(hf).toBe(1.0);
    });

    test('returns NaN when getAccountLiquidity throws', async () => {
      const { calculator, comptroller } = buildCalculator();
      jest.spyOn(comptroller, 'getAccountLiquidity').mockRejectedValueOnce(new Error('boom'));

      const hf = await calculator.calculateHealthFactor(TEST_ACCOUNTS[0]);

      expect(Number.isNaN(hf)).toBe(true);
    });

    test('handles large shortfall approaching zero', async () => {
      const { calculator, comptroller } = buildCalculator();
      comptroller.setAccountLiquidity(TEST_ACCOUNTS[0], { error: 0n, liquidity: 1n, shortfall: LARGE_SHORTFALL });

      const hf = await calculator.calculateHealthFactor(TEST_ACCOUNTS[0]);

      expect(hf).toBeGreaterThanOrEqual(0);
      expect(hf).toBeLessThan(0.01);
    });

    test('returns finite value even when comptroller signals error code', async () => {
      const { calculator, comptroller } = buildCalculator();
      comptroller.setAccountLiquidity(TEST_ACCOUNTS[0], { error: 9n, liquidity: HEALTHY_LIQUIDITY, shortfall: SMALL_SHORTFALL });

      const hf = await calculator.calculateHealthFactor(TEST_ACCOUNTS[0]);

      expect(Number.isFinite(hf)).toBe(true);
      expect(hf).toBeGreaterThan(0);
      expect(hf).toBeLessThan(1);
    });

    test('handles extremely large liquidity and shortfall without overflowing', async () => {
      const { calculator, comptroller } = buildCalculator();
      const huge = BigInt('1' + '0'.repeat(30));
      comptroller.setAccountLiquidity(TEST_ACCOUNTS[0], { error: 0n, liquidity: huge, shortfall: huge * 2n });

      const hf = await calculator.calculateHealthFactor(TEST_ACCOUNTS[0]);

      expect(Number.isFinite(hf)).toBe(true);
      expect(hf).toBeGreaterThan(0);
      expect(hf).toBeLessThan(1);
    });
  });

  describe('getPositionDetails', () => {
    test('aggregates collateral and debt across multiple markets', async () => {
      const { calculator, comptroller, oracle, vWBNB, vUSDT } = buildCalculator();
      comptroller.setAssetsIn(TEST_ACCOUNTS[1], [TEST_VTOKENS.vWBNB, TEST_VTOKENS.vUSDT]);

      vWBNB.setAccountSnapshot(TEST_ACCOUNTS[1], {
        error: 0n,
        vTokenBalance: parseUnits('100', 18),
        borrowBalance: 0n,
        exchangeRate: parseUnits('0.02', 18),
      });
      vUSDT.setAccountSnapshot(TEST_ACCOUNTS[1], {
        error: 0n,
        vTokenBalance: 0n,
        borrowBalance: parseUnits('500', 8),
        exchangeRate: parseUnits('1', 18),
      });

      oracle.setPriceUsd(TEST_VTOKENS.vUSDT, 1, 6);

      const position = await calculator.getPositionDetails(TEST_ACCOUNTS[1]);

      expectPositionDetailsValid(position);
      expect(position.collateralTokens.length).toBe(1);
      expect(position.borrowTokens.length).toBe(1);
      expect(position.debtValueUsd).toBeGreaterThan(0);
      expect(position.collateralValueUsd).toBeGreaterThan(0);
      expectAccountLiquidityValid(position.accountLiquidity);
    });

    test('skips market when snapshot returns error', async () => {
      const { calculator, comptroller, vWBNB } = buildCalculator();
      comptroller.setAssetsIn(TEST_ACCOUNTS[2], [TEST_VTOKENS.vWBNB]);
      vWBNB.setAccountSnapshot(TEST_ACCOUNTS[2], {
        error: 1n,
        vTokenBalance: 0n,
        borrowBalance: 0n,
        exchangeRate: parseUnits('0.02', 18),
      });

      const position = await calculator.getPositionDetails(TEST_ACCOUNTS[2]);

      expect(position.collateralTokens.length).toBe(0);
      expect(position.borrowTokens.length).toBe(0);
    });

    test('continues when oracle price throws for one market', async () => {
      const { calculator, comptroller, oracle, vWBNB, vUSDT } = buildCalculator();
      comptroller.setAssetsIn(TEST_ACCOUNTS[0], [TEST_VTOKENS.vWBNB, TEST_VTOKENS.vUSDT]);
      vWBNB.setAccountSnapshot(TEST_ACCOUNTS[0], {
        error: 0n,
        vTokenBalance: parseUnits('50', 18),
        borrowBalance: 0n,
        exchangeRate: parseUnits('0.02', 18),
      });
      vUSDT.setAccountSnapshot(TEST_ACCOUNTS[0], {
        error: 0n,
        vTokenBalance: 0n,
        borrowBalance: parseUnits('100', 8),
        exchangeRate: parseUnits('1', 18),
      });
      jest.spyOn(oracle, 'getUnderlyingPrice').mockImplementationOnce(async () => {
        throw new Error('oracle down');
      });

      const position = await calculator.getPositionDetails(TEST_ACCOUNTS[0]);

      expect(position.borrowTokens.length).toBe(1);
      expect(position.collateralTokens.length).toBe(0);
    });

    test('skips markets that overflow to Infinity during USD conversion', async () => {
      const { calculator, comptroller, oracle, vWBNB, vUSDT } = buildCalculator();
      comptroller.setAssetsIn(TEST_ACCOUNTS[2], [TEST_VTOKENS.vWBNB, TEST_VTOKENS.vUSDT]);

      const massive = BigInt('1' + '0'.repeat(28));
      const enormousPrice = BigInt('1' + '0'.repeat(40));
      oracle.setPrice(TEST_VTOKENS.vWBNB, enormousPrice);
      vWBNB.setAccountSnapshot(TEST_ACCOUNTS[2], {
        error: 0n,
        vTokenBalance: massive,
        borrowBalance: massive,
        exchangeRate: parseUnits('1', 18),
      });

      vUSDT.setAccountSnapshot(TEST_ACCOUNTS[2], {
        error: 0n,
        vTokenBalance: parseUnits('10', 18),
        borrowBalance: parseUnits('5', 18),
        exchangeRate: parseUnits('1', 18),
      });

      const position = await calculator.getPositionDetails(TEST_ACCOUNTS[2]);

      expect(position.collateralDetails.find((d) => d.vToken === TEST_VTOKENS.vWBNB)).toBeUndefined();
      expect(position.borrowDetails.find((d) => d.vToken === TEST_VTOKENS.vWBNB)).toBeUndefined();
      expect(position.collateralTokens).toContain(TEST_VTOKENS.vUSDT);
      expect(position.borrowTokens).toContain(TEST_VTOKENS.vUSDT);
    });

    test('handles zero-debt positions while keeping health factor finite', async () => {
      const { calculator, comptroller, vWBNB } = buildCalculator();
      comptroller.setAssetsIn(TEST_ACCOUNTS[1], [TEST_VTOKENS.vWBNB]);
      comptroller.setAccountLiquidity(TEST_ACCOUNTS[1], { error: 0n, liquidity: 0n, shortfall: 0n });
      vWBNB.setAccountSnapshot(TEST_ACCOUNTS[1], {
        error: 0n,
        vTokenBalance: parseUnits('50', 18),
        borrowBalance: 0n,
        exchangeRate: parseUnits('0.02', 18),
      });

      const position = await calculator.getPositionDetails(TEST_ACCOUNTS[1]);

      expect(position.debtValueUsd).toBe(0);
      expect(Number.isFinite(position.healthFactor)).toBe(true);
      expect(position.healthFactor).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isLiquidatable & incentive', () => {
    test('identifies liquidatable when hf < 1 and debt above min', async () => {
      const { calculator } = buildCalculator();
      const position = createVenusPosition({ healthFactor: 0.8, debtValueUsd: 1_000 });

      const result = calculator.isLiquidatable(position, 100);

      expect(result).toBe(true);
    });

    test('returns false for NaN/Infinity and small debt', async () => {
      const { calculator } = buildCalculator();
      const nanPosition = createVenusPosition({ healthFactor: Number.NaN, debtValueUsd: 10_000 });
      const infPosition = createVenusPosition({ healthFactor: Number.POSITIVE_INFINITY, debtValueUsd: 10_000 });
      const smallDebt = createVenusPosition({ healthFactor: 0.5, debtValueUsd: 50 });

      expect(calculator.isLiquidatable(nanPosition, 100)).toBe(false);
      expect(calculator.isLiquidatable(infPosition, 100)).toBe(false);
      expect(calculator.isLiquidatable(smallDebt, 100)).toBe(false);
    });

    test('gets liquidation incentive and converts mantissa', async () => {
      const comptroller = new MockComptroller();
      comptroller.setLiquidationIncentive(DEFAULT_LIQUIDATION_INCENTIVE);
      const { wrapper } = createMockVenusContractsWrapper({ comptroller });
      const calculator = new HealthFactorCalculator(wrapper as any);

      const incentive = await calculator.getLiquidationIncentive();

      expect(incentive).toBeCloseTo(1.08, 2);
    });
  });
});

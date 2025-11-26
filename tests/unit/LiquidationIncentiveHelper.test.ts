import { MockComptroller } from '../mocks/MockComptroller';
import { getLiquidationIncentiveDecimal, getLiquidationIncentiveFromMarkets } from '../../src/services/liquidation/LiquidationIncentiveHelper';
import { VUSDT_VTOKEN_ADDRESS } from '../../src/config/vTokens';
import { DEFAULT_LIQUIDATION_INCENTIVE_MANTISSA, HIGH_LIQUIDATION_INCENTIVE_MANTISSA } from '../utils/testData';

// Mock Venus Contracts wrapper
function createMockVenusContracts(comptroller: MockComptroller) {
  return {
    getComptroller: () => comptroller,
  };
}

describe('LiquidationIncentiveHelper', () => {
  describe('getLiquidationIncentiveDecimal', () => {
    test('gets liquidation incentive from comptroller using getLiquidationIncentive method', async () => {
      const comptroller = new MockComptroller();
      // Set a 10% bonus (1.10)
      comptroller.setLiquidationIncentive(BigInt('1100000000000000000')); // 1.10e18

      const mockVenusContracts = createMockVenusContracts(comptroller);
      const incentive = await getLiquidationIncentiveDecimal(mockVenusContracts as any);

      expect(incentive).toBeCloseTo(1.10, 2);
    });

    test('gets liquidation incentive with specified vToken address', async () => {
      const comptroller = new MockComptroller();
      comptroller.setLiquidationIncentive(DEFAULT_LIQUIDATION_INCENTIVE_MANTISSA); // 1.08e18

      const sampleVToken = '0xfd5840cd36d94d7229439859c0112a4185bc0255' as any;
      const mockVenusContracts = createMockVenusContracts(comptroller);
      const incentive = await getLiquidationIncentiveDecimal(mockVenusContracts as any, sampleVToken);

      expect(incentive).toBeCloseTo(1.08, 2);
    });

    test('returns fallback of 1.10 when getLiquidationIncentive fails', async () => {
      const comptroller = new MockComptroller();
      // Simulate error in getLiquidationIncentive by not having the method
      const incompleteComptroller = {
        ...comptroller,
        getLiquidationIncentive: async () => { throw new Error('Method not found'); }
      };

      const mockVenusContracts = {
        getComptroller: () => incompleteComptroller,
      };
      const incentive = await getLiquidationIncentiveDecimal(mockVenusContracts as any);

      expect(incentive).toBe(1.10);
    });
  });

  describe('getLiquidationIncentiveFromMarkets', () => {
    test('gets liquidation incentive from markets() method', async () => {
      const comptroller = new MockComptroller();
      // Set a 15% bonus (1.15) in markets for the default vUSDT address
      comptroller.setMarketsWithLiquidationIncentive(HIGH_LIQUIDATION_INCENTIVE_MANTISSA, VUSDT_VTOKEN_ADDRESS); // 1.15e18

      const mockVenusContracts = createMockVenusContracts(comptroller);
      const incentive = await getLiquidationIncentiveFromMarkets(mockVenusContracts as any);

      expect(incentive).toBeCloseTo(1.15, 2);
    });

    test('gets liquidation incentive with specified vToken address', async () => {
      const comptroller = new MockComptroller();
      const sampleVToken = '0xFD5840Cd36d95D72D3EE08dE4e6b222D4a50A024' as any; // should use VUSDT constant
      comptroller.setMarketsWithLiquidationIncentive(DEFAULT_LIQUIDATION_INCENTIVE_MANTISSA, sampleVToken);

      const mockVenusContracts = createMockVenusContracts(comptroller);
      const incentive = await getLiquidationIncentiveFromMarkets(mockVenusContracts as any, sampleVToken);

      expect(incentive).toBeCloseTo(1.08, 2);
    });

    test('returns fallback of 1.10 when markets() fails', async () => {
      const comptroller = new MockComptroller();
      // Simulate error in markets by not having the method
      const incompleteComptroller = {
        ...comptroller,
        markets: async () => { throw new Error('Method not found'); }
      };

      const mockVenusContracts = {
        getComptroller: () => incompleteComptroller,
      };
      const incentive = await getLiquidationIncentiveFromMarkets(mockVenusContracts as any);

      expect(incentive).toBe(1.10);
    });
  });

  describe('consistency between helpers', () => {
    test('both helpers return same liquidation incentive for same vUSDT address', async () => {
      const comptroller = new MockComptroller();
      const vUSDTAddress = '0xfd5840cd36d94d7229439859c0112a4185bc0255' as any;

      // Set same incentive for both methods
      comptroller.setLiquidationIncentive(DEFAULT_LIQUIDATION_INCENTIVE_MANTISSA);
      comptroller.setMarketsWithLiquidationIncentive(DEFAULT_LIQUIDATION_INCENTIVE_MANTISSA, vUSDTAddress);

      const mockVenusContracts = createMockVenusContracts(comptroller);

      const incentiveDecimal = await getLiquidationIncentiveDecimal(mockVenusContracts as any, vUSDTAddress);
      const incentiveFromMarkets = await getLiquidationIncentiveFromMarkets(mockVenusContracts as any, vUSDTAddress);

      // Both should return the same value
      expect(incentiveDecimal).toBeCloseTo(incentiveFromMarkets, 2);
      expect(incentiveDecimal).toBeCloseTo(1.08, 2);
    });

    test('default behavior uses consistent vUSDT address', async () => {
      const comptroller = new MockComptroller();

      // Set same incentive for both methods (default case)
      comptroller.setLiquidationIncentive(DEFAULT_LIQUIDATION_INCENTIVE_MANTISSA);

      const mockVenusContracts = createMockVenusContracts(comptroller);

      const defaultIncentiveDecimal = await getLiquidationIncentiveDecimal(mockVenusContracts as any);
      const defaultIncentiveFromMarkets = await getLiquidationIncentiveFromMarkets(mockVenusContracts as any);

      // Should use the same default vUSDT address
      expect(defaultIncentiveDecimal).toBeCloseTo(defaultIncentiveFromMarkets, 2);
    });
  });
});
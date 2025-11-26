import { Address } from '../../types';
import VenusContracts from '../../contracts';
import { logger } from '../../utils/logger';
import { formatUnits } from 'ethers';
import { VUSDT_VTOKEN_ADDRESS } from '../../config/vTokens';

/**
 * Helper function to get liquidation incentive with proper Diamond API handling
 * This consolidates the duplicated logic from multiple files into a single source of truth.
 *
 * @param venusContracts - Venus contracts instance
 * @param vTokenAddress - Optional vToken address, defaults to vUSDT (0xfd5840cd36d94d7229439859c0112a4185bc0255)
 * @returns Liquidation incentive as a decimal (e.g., 1.08 for 8% bonus)
 */
export async function getLiquidationIncentiveDecimal(
  venusContracts: VenusContracts,
  vTokenAddress?: Address
): Promise<number> {
  const targetVToken = vTokenAddress || VUSDT_VTOKEN_ADDRESS;

  try {
    const comptroller = venusContracts.getComptroller();

    const liqMantissa = await comptroller.getLiquidationIncentive(targetVToken);
    logger.info('Raw liquidation incentive from Diamond API', {
      vToken: targetVToken,
      mantissa: liqMantissa.toString()
    });

    // Диагностика: что отдаёт markets().liquidationIncentiveMantissa
    try {
      const marketData = await comptroller.markets(targetVToken);
      logger.info('Raw liquidation incentive from markets() diagnostic', {
        vToken: targetVToken,
        mantissa: marketData.liquidationIncentiveMantissa.toString()
      });
    } catch (marketsError) {
      logger.debug('markets() недоступен для диагностики liquidation incentive', {
        vToken: targetVToken,
        error: marketsError
      });
    }

    const liqRatio = Number(formatUnits(liqMantissa, 18)); // ожидаем >= 1.0

    if (liqRatio >= 1.0) {
      const liquidationIncentiveDecimal = liqRatio;
      const bonusPercent = (liquidationIncentiveDecimal - 1) * 100;

      logger.info('Liquidation bonus calculated successfully', {
        incentiveDecimal: liquidationIncentiveDecimal,
        bonusPercent: `${bonusPercent}%`,
        vToken: targetVToken,
        source: 'getLiquidationIncentive'
      });

      return liquidationIncentiveDecimal;
    } else {
      logger.warn('Liquidation incentive < 1.0 из getLiquidationIncentive, fallback to 1.10', {
        ratio: liqRatio,
        vToken: targetVToken
      });
      return 1.10;
    }
  } catch (error) {
    logger.warn('Не удалось получить liquidation incentive из getLiquidationIncentive, fallback to 1.10', {
      vToken: targetVToken,
      error
    });
    return 1.10;
  }
}

/**
 * Alternative implementation that uses markets() method directly
 * This is used when getLiquidationIncentive is not available on the contract
 *
 * @param venusContracts - Venus contracts instance
 * @param vTokenAddress - Optional vToken address
 * @returns Liquidation incentive as a decimal
 */
export async function getLiquidationIncentiveFromMarkets(
  venusContracts: VenusContracts,
  vTokenAddress?: Address
): Promise<number> {
  const targetVToken = vTokenAddress || VUSDT_VTOKEN_ADDRESS;

  try {
    const marketData = await venusContracts.getComptroller().markets(targetVToken);
    const liqIncentiveDecimal = Number(marketData.liquidationIncentiveMantissa) / 1e18;

    logger.info('Liquidation incentive retrieved from markets() method', {
      vToken: targetVToken,
      incentiveDecimal: liqIncentiveDecimal,
      bonusPercent: `${(liqIncentiveDecimal - 1) * 100}%`
    });

    return liqIncentiveDecimal;
  } catch (error) {
    logger.warn('Failed to get liquidation incentive from markets(), fallback to 1.10', {
      vToken: targetVToken,
      error
    });
    return 1.10;
  }
}
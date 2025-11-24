import { Address, TokenPositionDetail, VenusPosition } from '../../types';
import VenusContracts from '../../contracts';
import { logger } from '../../utils/logger';

const USD_SCALE = 10n ** 36n;
const EXCHANGE_RATE_SCALE = 10n ** 18n;
const USD_RESULT_SCALE = 1_000_000n; // 1e6 precision for USD conversions

class HealthFactorCalculator {
  constructor(private readonly venusContracts: VenusContracts) {}

  async calculateHealthFactor(account: Address): Promise<number> {
    try {
      const accountLiquidity = await this.venusContracts.getComptroller().getAccountLiquidity(account);
      if (accountLiquidity.error !== 0n) {
        logger.warn('Comptroller getAccountLiquidity returned error', { account, error: accountLiquidity.error });
      }

      const { liquidity, shortfall } = accountLiquidity;
      if (shortfall > 0n) {
        const total = liquidity + shortfall;
        if (total === 0n) {
          return 0;
        }
        const scale = 10_000n;
        const mantissa = (liquidity * scale) / total;
        return Number(mantissa) / Number(scale);
      }

      if (liquidity > 0n) {
        return Number.POSITIVE_INFINITY;
      }

      return 1.0;
    } catch (error) {
      logger.warn('Failed to calculate health factor', { account, error });
      return Number.NaN;
    }
  }

  async getPositionDetails(account: Address): Promise<VenusPosition> {
    const comptroller = this.venusContracts.getComptroller();
    const oracle = this.venusContracts.getOracle();

    let collateralValueUsd = 0;
    let debtValueUsd = 0;
    const collateralTokens: Address[] = [];
    const borrowTokens: Address[] = [];
    const collateralDetails: TokenPositionDetail[] = [];
    const borrowDetails: TokenPositionDetail[] = [];

    const assetsIn = await comptroller.getAssetsIn(account);

    for (const vTokenAddress of assetsIn) {
      try {
        const vToken = this.venusContracts.getVToken(vTokenAddress);
        const snapshot = await vToken.getAccountSnapshot(account);

        if (snapshot.error !== 0n) {
          logger.warn('getAccountSnapshot returned error', { account, vToken: vTokenAddress, error: snapshot.error });
          continue;
        }

        const price = await oracle.getUnderlyingPrice(vTokenAddress);
        const collateralUnderlying = (snapshot.vTokenBalance * snapshot.exchangeRate) / EXCHANGE_RATE_SCALE;
        const collateralUsdScaled = (collateralUnderlying * price * USD_RESULT_SCALE) / USD_SCALE;
        const collateralUsd = this.toNumberWithScale(collateralUsdScaled, USD_RESULT_SCALE, 'collateralUsd');
        if (!Number.isFinite(collateralUsd)) {
          logger.error('Non-finite collateral value detected', {
            account,
            vToken: vTokenAddress,
            rawValue: collateralUsdScaled.toString(),
          });
          continue;
        }
        if (collateralUnderlying > 0n) {
          collateralTokens.push(vTokenAddress);
          collateralDetails.push({
            vToken: vTokenAddress,
            amount: collateralUnderlying,
            valueUsd: collateralUsd,
            decimals: 18,
          });
          collateralValueUsd += collateralUsd;
        }

        if (snapshot.borrowBalance > 0n) {
          const debtUsdScaled = (snapshot.borrowBalance * price * USD_RESULT_SCALE) / USD_SCALE;
          const debtUsd = this.toNumberWithScale(debtUsdScaled, USD_RESULT_SCALE, 'debtUsd');
          if (!Number.isFinite(debtUsd)) {
            logger.error('Non-finite debt value detected', {
              account,
              vToken: vTokenAddress,
              rawValue: debtUsdScaled.toString(),
            });
            continue;
          }
          borrowTokens.push(vTokenAddress);
          borrowDetails.push({
            vToken: vTokenAddress,
            amount: snapshot.borrowBalance,
            valueUsd: debtUsd,
            decimals: 18,
          });
          debtValueUsd += debtUsd;
        }
      } catch (error) {
        logger.warn('Failed to fetch position details for market', { account, vToken: vTokenAddress, error });
        continue;
      }
    }

    const accountLiquidity = await comptroller.getAccountLiquidity(account);
    const healthFactor = await this.calculateHealthFactor(account);

    return {
      borrower: account,
      healthFactor,
      collateralValueUsd,
      debtValueUsd,
      collateralTokens,
      borrowTokens,
      collateralDetails,
      borrowDetails,
      accountLiquidity,
    };
  }

  isLiquidatable(position: VenusPosition, minPositionSizeUsd: number): boolean {
    if (!Number.isFinite(position.healthFactor)) {
      return false;
    }

    return position.healthFactor < 1.0 && position.debtValueUsd >= minPositionSizeUsd;
  }

  async getLiquidationIncentive(): Promise<number> {
    const mantissa = await this.venusContracts.getComptroller().liquidationIncentiveMantissa();
    return Number(mantissa) / 1e18;
  }

  private toNumberWithScale(value: bigint, scale: bigint, label: string): number {
    if (scale === 0n) {
      throw new Error(`Scale for ${label} cannot be zero`);
    }

    const integerPart = value / scale;
    const fractionalPart = value % scale;
    const fractionalScaled = (fractionalPart * 1_000_000n) / scale;

    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    if (integerPart > maxSafe || integerPart < -maxSafe) {
      logger.warn('Value exceeds safe JS number range after scaling', { label, value: value.toString() });
      return Number.POSITIVE_INFINITY;
    }

    const result = Number(integerPart) + Number(fractionalScaled) / 1_000_000;
    if (!Number.isFinite(result)) {
      logger.warn('Converted number is not finite', { label, value: value.toString() });
      return Number.POSITIVE_INFINITY;
    }

    return result;
  }
}

export default HealthFactorCalculator;

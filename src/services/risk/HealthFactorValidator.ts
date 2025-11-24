import { LiquidatablePosition, RiskCheckResult, RiskCheckType } from '../../types';
import VenusContracts from '../../contracts/VenusContracts';
import { logger } from '../../utils/logger';

class HealthFactorValidator {
  constructor(private readonly venusContracts: VenusContracts) {}

  async validateHealthFactor(position: LiquidatablePosition): Promise<RiskCheckResult> {
    try {
      const accountLiquidity = await this.venusContracts.getComptroller().getAccountLiquidity(position.borrower);
      if (Number(accountLiquidity.error) !== 0) {
        logger.warn('Comptroller getAccountLiquidity returned error', { error: accountLiquidity.error });
      }

      const liquidityNum = Number(accountLiquidity.liquidity);
      const shortfallNum = Number(accountLiquidity.shortfall);
      const currentHF = shortfallNum > 0 ? liquidityNum / (liquidityNum + shortfallNum) : Number.POSITIVE_INFINITY;

      if (currentHF >= 1) {
        logger.warn('Position no longer liquidatable', { borrower: position.borrower, currentHF });
        return {
          passed: false,
          checkType: RiskCheckType.HEALTH_FACTOR_CHANGED,
          reason: 'Position is no longer liquidatable',
          details: { previousHF: position.healthFactor, currentHF },
        };
      }

      const delta = Math.abs(position.healthFactor - currentHF);
      if (delta / Math.max(position.healthFactor || 1, 1) > 0.1) {
        logger.warn('Health factor changed significantly since detection', {
          previousHF: position.healthFactor,
          currentHF,
        });
      } else {
        logger.debug('Health factor re-validation passed', { currentHF });
      }

      return { passed: true, checkType: RiskCheckType.HEALTH_FACTOR_CHANGED };
    } catch (error) {
      logger.warn('Health factor validation failed', { error: (error as Error).message });
      return {
        passed: false,
        checkType: RiskCheckType.HEALTH_FACTOR_CHANGED,
        reason: 'Failed to validate health factor',
      };
    }
  }
}

export default HealthFactorValidator;

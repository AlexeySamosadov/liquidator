import { BotConfig, Address, RiskCheckResult, RiskCheckType } from '../../types';
import { logger } from '../../utils/logger';

class TokenValidator {
  constructor(private readonly config: BotConfig) {}

  validateTokens(repayToken: Address, seizeToken: Address): RiskCheckResult[] {
    const failed: RiskCheckResult[] = [];
    const repay = repayToken.toLowerCase();
    const seize = seizeToken.toLowerCase();
    const whitelist = this.config.tokenWhitelist || [];
    const blacklist = this.config.tokenBlacklist || [];

    if (whitelist.length > 0) {
      const notAllowed: string[] = [];
      if (!whitelist.includes(repay)) notAllowed.push('repay');
      if (!whitelist.includes(seize)) notAllowed.push('seize');
      if (notAllowed.length > 0) {
        logger.warn('Token not in whitelist', { repayToken, seizeToken });
        failed.push({
          passed: false,
          checkType: RiskCheckType.TOKEN_WHITELIST,
          reason: 'Token not in whitelist',
          details: { repayToken, seizeToken, missing: notAllowed },
        });
        return failed;
      }
      logger.debug('Whitelist validation passed', { repayToken, seizeToken });
      return failed;
    }

    if (blacklist.includes(repay) || blacklist.includes(seize)) {
      logger.warn('Token is blacklisted', { repayToken, seizeToken });
      failed.push({
        passed: false,
        checkType: RiskCheckType.TOKEN_BLACKLIST,
        reason: 'Token is blacklisted',
        details: { repayToken, seizeToken },
      });
    }

    return failed;
  }
}

export default TokenValidator;

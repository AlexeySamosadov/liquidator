import { Contract, Wallet } from 'ethers';
import { LiquidatablePosition, LiquidationMode, RiskCheckResult, RiskCheckType } from '../../types';
import VenusContracts from '../../contracts/VenusContracts';
import { logger } from '../../utils/logger';

class BalanceChecker {
  constructor(
    private readonly signer: Wallet,
    private readonly venusContracts: VenusContracts,
  ) {}

  async checkBalance(position: LiquidatablePosition, mode: LiquidationMode): Promise<RiskCheckResult> {
    if (mode === LiquidationMode.FLASH_LOAN) {
      return { passed: true, checkType: RiskCheckType.INSUFFICIENT_BALANCE };
    }

    const provider = this.signer.provider;
    if (!provider) {
      return {
        passed: false,
        checkType: RiskCheckType.INSUFFICIENT_BALANCE,
        reason: 'Provider not available on signer',
      };
    }

    let required = position.repayAmount;
    let available: bigint;

    try {
      const vToken = this.venusContracts.getVToken(position.repayToken);
      const underlying = await vToken.underlying().catch(() => null);

      if (!underlying) {
        // Native BNB (vBNB)
        available = await provider.getBalance(this.signer.address);
      } else {
        const erc20 = new Contract(underlying, ['function balanceOf(address) view returns (uint256)'], provider);
        available = await erc20.balanceOf(this.signer.address);
      }
    } catch (error) {
      logger.warn('Balance check failed while fetching token balance', { error: (error as Error).message });
      return {
        passed: false,
        checkType: RiskCheckType.INSUFFICIENT_BALANCE,
        reason: 'Failed to fetch balance',
      };
    }

    if (available < required) {
      logger.warn('Wallet balance insufficient', { required: required.toString(), available: available.toString() });
      return {
        passed: false,
        checkType: RiskCheckType.INSUFFICIENT_BALANCE,
        reason: 'Wallet balance insufficient',
        details: { required: required.toString(), available: available.toString() },
      };
    }

    logger.debug('Sufficient balance for liquidation', { available: available.toString(), required: required.toString() });
    return { passed: true, checkType: RiskCheckType.INSUFFICIENT_BALANCE };
  }
}

export default BalanceChecker;

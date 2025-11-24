import { Contract, Wallet } from 'ethers';
import VenusContracts from '../../contracts';
import { LiquidatablePosition, LiquidationMode, LiquidationResult } from '../../types';
import { logger } from '../../utils/logger';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
];

class StandardLiquidator {
  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly signer: Wallet,
    private readonly liquidationBonusPercent: number,
  ) {}

  private async getUnderlyingAddress(vTokenAddress: string): Promise<string | null> {
    const vToken = this.venusContracts.getVToken(vTokenAddress);
    try {
      return await vToken.underlying();
    } catch (error) {
      logger.debug('Underlying fetch failed (likely vBNB)', { error: (error as Error).message });
      return null;
    }
  }

  private async checkBalance(repayToken: string, repayAmount: bigint): Promise<boolean> {
    const underlying = await this.getUnderlyingAddress(repayToken);
    if (!underlying) {
      const provider = this.signer.provider;
      if (!provider) return false;
      const balance = await provider.getBalance(this.signer.address);
      logger.debug('Native balance check', { balance: balance.toString(), repayAmount: repayAmount.toString() });
      return balance >= repayAmount;
    }

    const token = new Contract(underlying, ERC20_ABI, this.signer);
    const balance: bigint = await token.balanceOf(this.signer.address);
    logger.debug('ERC20 balance check', { token: underlying, balance: balance.toString(), repayAmount: repayAmount.toString() });
    return balance >= repayAmount;
  }

  private async approveToken(tokenAddress: string, spender: string, amount: bigint): Promise<void> {
    const token = new Contract(tokenAddress, ERC20_ABI, this.signer);
    const current: bigint = await token.allowance(this.signer.address, spender);
    if (current >= amount) {
      logger.debug('Allowance sufficient', { token: tokenAddress, spender });
      return;
    }

    const tx = await token.approve(spender, amount);
    await tx.wait();
    logger.info('Token approved for liquidation', { token: tokenAddress, spender, txHash: tx.hash });
  }

  async executeLiquidation(
    position: LiquidatablePosition,
    gasParams: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  ): Promise<LiquidationResult> {
    try {
      const underlying = await this.getUnderlyingAddress(position.repayToken);
      const hasBalance = await this.checkBalance(position.repayToken, position.repayAmount);
      if (!hasBalance) {
        throw new Error('Insufficient balance for liquidation');
      }

      if (underlying) {
        await this.approveToken(underlying, position.repayToken, position.repayAmount);
      }

      const vToken = this.venusContracts.getVToken(position.repayToken).connect(this.signer) as any;
      const tx = await vToken.liquidateBorrow(
        position.borrower,
        position.repayAmount,
        position.seizeToken,
        {
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
          value: underlying ? 0n : position.repayAmount,
        },
      );

      const receipt = await tx.wait();
      const gasUsed = receipt?.gasUsed ? BigInt(receipt.gasUsed) : undefined;
      const gasPriceGwei = Number(gasParams.maxFeePerGas) / 1e9;

      const result: LiquidationResult = {
        success: true,
        txHash: tx.hash,
        mode: LiquidationMode.STANDARD,
        repayAmount: position.repayAmount,
        seizeAmount: undefined,
        repayToken: position.repayToken,
        seizeToken: position.seizeToken,
        gasUsed,
        gasPriceGwei,
        liquidationBonus: this.liquidationBonusPercent,
        timestamp: Date.now(),
        profitUsd: position.estimatedProfitUsd,
        gasUsd: undefined,
      };

      logger.info('Standard liquidation executed', { borrower: position.borrower, txHash: tx.hash });
      return result;
    } catch (error) {
      logger.error('Standard liquidation failed', { error: (error as Error).message, borrower: position.borrower });
      return {
        success: false,
        error: (error as Error).message,
        mode: LiquidationMode.STANDARD,
        timestamp: Date.now(),
      };
    }
  }
}

export default StandardLiquidator;

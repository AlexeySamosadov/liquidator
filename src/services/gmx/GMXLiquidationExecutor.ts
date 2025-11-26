/**
 * GMX Liquidation Executor
 * Executes GMX liquidations via private orderflow (bloXroute)
 */

import { Wallet, TransactionRequest } from 'ethers';
import { GMXContracts } from '../../contracts/GMXContracts';
import { PrivateTransactionService } from '../transaction/PrivateTransactionService';
import { GMXLiquidatablePosition, LiquidationResult } from '../../types';
import { OrderType, DecreasePositionSwapType } from '../../contracts/interfaces/IGMXExchangeRouter';
import { logger } from '../../utils/logger';

/**
 * GMXLiquidationExecutor handles liquidation execution for GMX positions
 */
export class GMXLiquidationExecutor {
  constructor(
    private readonly gmxContracts: GMXContracts,
    private readonly privateTransactionService: PrivateTransactionService,
    private readonly wallet: Wallet,
    private readonly minProfitUsd: number = 1,
    private readonly maxGasPriceGwei: number = 2
  ) {
    logger.info('GMXLiquidationExecutor initialized', {
      minProfitUsd,
      maxGasPriceGwei,
      privateOrderflow: privateTransactionService.isPrivateOrderflowAvailable(),
    });
  }

  /**
   * Execute liquidation for a position
   */
  async liquidate(position: GMXLiquidatablePosition): Promise<LiquidationResult> {
    const startTime = Date.now();

    try {
      logger.info('🎯 Executing liquidation...', {
        account: position.position.account,
        market: position.marketInfo.marketToken,
        healthFactor: position.healthFactor.toFixed(4),
        sizeUsd: position.sizeValueUsd.toFixed(2),
        estimatedProfit: position.estimatedProfitUsd.toFixed(2),
      });

      // Pre-flight checks
      const canLiquidate = await this.preflightChecks(position);
      if (!canLiquidate.success) {
        return {
          success: false,
          error: canLiquidate.error,
          timestamp: Date.now(),
        };
      }

      // Build liquidation transaction
      const tx = await this.buildLiquidationTransaction(position);

      // Send transaction via bloXroute
      const result = await this.privateTransactionService.sendPrivateTransaction(tx);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          timestamp: Date.now(),
        };
      }

      logger.info('📤 Liquidation transaction sent', {
        txHash: result.txHash,
        isPrivate: result.isPrivate,
        method: result.isPrivate ? 'bloXroute' : 'public RPC',
      });

      // Wait for confirmation
      const confirmed = await this.privateTransactionService.waitForTransaction(
        result.txHash!,
        1 // 1 confirmation
      );

      if (!confirmed) {
        return {
          success: false,
          txHash: result.txHash,
          error: 'Transaction failed or reverted',
          timestamp: Date.now(),
        };
      }

      const duration = Date.now() - startTime;

      logger.info('✅ Liquidation successful!', {
        txHash: result.txHash,
        account: position.position.account,
        duration: `${duration}ms`,
        estimatedProfit: position.estimatedProfitUsd.toFixed(2),
        isPrivate: result.isPrivate,
      });

      return {
        success: true,
        txHash: result.txHash,
        profitUsd: position.estimatedProfitUsd,
        repayToken: position.position.collateralToken,
        timestamp: Date.now(),
        details: {
          account: position.position.account,
          market: position.marketInfo.marketToken,
          healthFactor: position.healthFactor,
          sizeUsd: position.sizeValueUsd,
          isPrivate: result.isPrivate,
          duration,
        },
      };
    } catch (error: any) {
      logger.error('❌ Liquidation failed', {
        account: position.position.account,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Pre-flight checks before liquidation
   */
  private async preflightChecks(
    position: GMXLiquidatablePosition
  ): Promise<{ success: boolean; error?: string }> {
    // Check 1: Profitability
    if (position.estimatedProfitUsd < this.minProfitUsd) {
      return {
        success: false,
        error: `Insufficient profit: $${position.estimatedProfitUsd.toFixed(2)} < $${this.minProfitUsd}`,
      };
    }

    // Check 2: Gas price
    const gasPrice = await this.privateTransactionService.getGasPrice();
    const gasPriceGwei = Number(gasPrice) / 1e9;

    if (gasPriceGwei > this.maxGasPriceGwei) {
      return {
        success: false,
        error: `Gas price too high: ${gasPriceGwei.toFixed(2)} gwei > ${this.maxGasPriceGwei} gwei`,
      };
    }

    // Check 3: Health factor still critical
    if (position.healthFactor >= 1.0) {
      return {
        success: false,
        error: `Position not liquidatable: HF ${position.healthFactor.toFixed(4)} >= 1.0`,
      };
    }

    logger.debug('✅ Preflight checks passed', {
      profit: position.estimatedProfitUsd.toFixed(2),
      gasPriceGwei: gasPriceGwei.toFixed(4),
      healthFactor: position.healthFactor.toFixed(4),
    });

    return { success: true };
  }

  /**
   * Build liquidation transaction
   */
  private async buildLiquidationTransaction(
    position: GMXLiquidatablePosition
  ): Promise<TransactionRequest> {
    const exchangeRouter = this.gmxContracts.getExchangeRouter();

    // Estimate gas
    const estimatedGas = position.gasEstimate || 300000n;
    const gasPrice = await this.privateTransactionService.getGasPrice();

    // Build decrease position order (liquidation)
    const createOrderParams = {
      addresses: {
        receiver: this.wallet.address,
        callbackContract: '0x0000000000000000000000000000000000000000',
        uiFeeReceiver: '0x0000000000000000000000000000000000000000',
        market: position.position.market,
        initialCollateralToken: position.position.collateralToken,
        swapPath: [], // No swap needed for liquidation
      },
      numbers: {
        sizeDeltaUsd: position.position.sizeInUsd, // Close entire position
        initialCollateralDeltaAmount: 0n,
        triggerPrice: 0n, // Market order
        acceptablePrice: 0n, // Any price (liquidation)
        executionFee: gasPrice * estimatedGas,
        callbackGasLimit: 0n,
        minOutputAmount: 0n,
      },
      orderType: OrderType.Liquidation,
      decreasePositionSwapType: DecreasePositionSwapType.NoSwap,
      isLong: position.position.isLong,
      shouldUnwrapNativeToken: false,
      referralCode: '0x' + '0'.repeat(64), // Empty referral code
    };

    // Populate transaction
    const tx = await exchangeRouter.createOrder.populateTransaction(createOrderParams);

    return {
      ...tx,
      from: this.wallet.address,
      gasLimit: estimatedGas * 12n / 10n, // +20% buffer
      gasPrice: gasPrice * 11n / 10n, // +10% for faster inclusion
      chainId: 42161, // Arbitrum
    };
  }

  /**
   * Batch liquidate multiple positions
   */
  async liquidateBatch(
    positions: GMXLiquidatablePosition[]
  ): Promise<LiquidationResult[]> {
    logger.info('🎯 Batch liquidation started', {
      count: positions.length,
    });

    const results: LiquidationResult[] = [];

    for (const position of positions) {
      const result = await this.liquidate(position);
      results.push(result);

      // Small delay between liquidations to avoid nonce issues
      if (result.success) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalProfit = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + (r.profitUsd || 0), 0);

    logger.info('✅ Batch liquidation completed', {
      total: positions.length,
      successful: successCount,
      failed: positions.length - successCount,
      totalProfit: totalProfit.toFixed(2),
    });

    return results;
  }

  /**
   * Check if position can be liquidated
   */
  canLiquidate(position: GMXLiquidatablePosition): boolean {
    return (
      position.healthFactor < 1.0 &&
      position.estimatedProfitUsd >= this.minProfitUsd
    );
  }

  /**
   * Get executor statistics
   */
  getStats() {
    return {
      minProfitUsd: this.minProfitUsd,
      maxGasPriceGwei: this.maxGasPriceGwei,
      privateOrderflowEnabled: this.privateTransactionService.isPrivateOrderflowAvailable(),
      executorAddress: this.wallet.address,
    };
  }
}

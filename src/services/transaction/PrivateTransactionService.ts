/**
 * Private Transaction Service
 * Sends transactions via bloXroute for MEV protection
 */

import { JsonRpcProvider, Wallet, TransactionRequest, TransactionResponse } from 'ethers';
import { logger } from '../../utils/logger';

export interface BloXrouteConfig {
  enabled: boolean;
  authHeader: string;
  rpcUrl: string;
  fallbackToPublic: boolean;
}

export interface PrivateTransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  isPrivate: boolean;
}

/**
 * PrivateTransactionService handles private transaction submission via bloXroute
 */
export class PrivateTransactionService {
  private readonly config: BloXrouteConfig;
  private readonly wallet: Wallet;
  private readonly publicProvider: JsonRpcProvider;
  private privateProvider?: JsonRpcProvider;

  constructor(
    wallet: Wallet,
    publicProvider: JsonRpcProvider,
    config: BloXrouteConfig
  ) {
    this.wallet = wallet;
    this.publicProvider = publicProvider;
    this.config = config;

    if (config.enabled && config.rpcUrl) {
      try {
        this.privateProvider = new JsonRpcProvider(config.rpcUrl);
        logger.info('bloXroute private RPC initialized', {
          rpcUrl: config.rpcUrl.substring(0, 30) + '...',
        });
      } catch (error) {
        logger.error('Failed to initialize bloXroute provider', { error });
        if (!config.fallbackToPublic) {
          throw error;
        }
      }
    }
  }

  /**
   * Send transaction via bloXroute private orderflow
   */
  async sendPrivateTransaction(
    tx: TransactionRequest
  ): Promise<PrivateTransactionResult> {
    // If bloXroute is not enabled, use public RPC
    if (!this.config.enabled || !this.privateProvider) {
      logger.debug('bloXroute disabled, using public RPC');
      return this.sendPublicTransaction(tx);
    }

    try {
      logger.info('Sending private transaction via bloXroute...', {
        to: tx.to,
        value: tx.value?.toString(),
      });

      // Sign transaction
      const signedTx = await this.wallet.signTransaction(tx);

      // Send via bloXroute with auth header
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.config.authHeader,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendRawTransaction',
          params: [signedTx],
        }),
      });

      const data = await response.json();

      if (data.error) {
        logger.error('bloXroute transaction failed', {
          error: data.error,
        });

        // Fallback to public if enabled
        if (this.config.fallbackToPublic) {
          logger.warn('Falling back to public RPC');
          return this.sendPublicTransaction(tx);
        }

        return {
          success: false,
          error: data.error.message || 'bloXroute transaction failed',
          isPrivate: false,
        };
      }

      const txHash = data.result;

      logger.info('✅ Private transaction sent via bloXroute', {
        txHash,
      });

      return {
        success: true,
        txHash,
        isPrivate: true,
      };
    } catch (error: any) {
      logger.error('Failed to send private transaction', { error });

      // Fallback to public if enabled
      if (this.config.fallbackToPublic) {
        logger.warn('Falling back to public RPC due to error');
        return this.sendPublicTransaction(tx);
      }

      return {
        success: false,
        error: error.message,
        isPrivate: false,
      };
    }
  }

  /**
   * Send transaction via public RPC (fallback)
   */
  private async sendPublicTransaction(
    tx: TransactionRequest
  ): Promise<PrivateTransactionResult> {
    try {
      logger.info('Sending public transaction...', {
        to: tx.to,
        value: tx.value?.toString(),
      });

      const walletConnected = this.wallet.connect(this.publicProvider);
      const response: TransactionResponse = await walletConnected.sendTransaction(tx);

      logger.info('✅ Public transaction sent', {
        txHash: response.hash,
      });

      return {
        success: true,
        txHash: response.hash,
        isPrivate: false,
      };
    } catch (error: any) {
      logger.error('Failed to send public transaction', { error });

      return {
        success: false,
        error: error.message,
        isPrivate: false,
      };
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(
    txHash: string,
    confirmations: number = 1
  ): Promise<boolean> {
    try {
      logger.debug('Waiting for transaction confirmation...', {
        txHash,
        confirmations,
      });

      const receipt = await this.publicProvider.waitForTransaction(
        txHash,
        confirmations
      );

      if (!receipt) {
        logger.error('Transaction receipt not found', { txHash });
        return false;
      }

      const success = receipt.status === 1;

      if (success) {
        logger.info('✅ Transaction confirmed', {
          txHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
        });
      } else {
        logger.error('❌ Transaction reverted', {
          txHash,
          blockNumber: receipt.blockNumber,
        });
      }

      return success;
    } catch (error) {
      logger.error('Failed to wait for transaction', { txHash, error });
      return false;
    }
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(tx: TransactionRequest): Promise<bigint> {
    try {
      const estimate = await this.publicProvider.estimateGas(tx);
      logger.debug('Gas estimated', {
        to: tx.to,
        estimatedGas: estimate.toString(),
      });
      return estimate;
    } catch (error) {
      logger.error('Failed to estimate gas', { error });
      throw error;
    }
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<bigint> {
    try {
      const feeData = await this.publicProvider.getFeeData();
      const gasPrice = feeData.gasPrice || 0n;

      logger.debug('Current gas price', {
        gasPrice: gasPrice.toString(),
        gasPriceGwei: Number(gasPrice) / 1e9,
      });

      return gasPrice;
    } catch (error) {
      logger.error('Failed to get gas price', { error });
      throw error;
    }
  }

  /**
   * Check if bloXroute is enabled and working
   */
  isPrivateOrderflowAvailable(): boolean {
    return this.config.enabled && this.privateProvider !== undefined;
  }

  /**
   * Get configuration
   */
  getConfig(): BloXrouteConfig {
    return { ...this.config };
  }
}

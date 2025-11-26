/**
 * GMX V2 Contract Manager
 * Manages connections to GMX V2 contracts on Arbitrum/Avalanche
 */

import { Contract, JsonRpcProvider, WebSocketProvider } from 'ethers';
import { Address, GMXAddresses } from '../types';
import { IGMXReader } from './interfaces/IGMXReader';
import { IGMXDataStore } from './interfaces/IGMXDataStore';
import { IGMXExchangeRouter } from './interfaces/IGMXExchangeRouter';
import { GMX_READER_ABI } from './abis/GMXReader.abi';
import { GMX_DATASTORE_ABI, DATASTORE_KEYS } from './abis/GMXDataStore.abi';
import { GMX_EXCHANGE_ROUTER_ABI } from './abis/GMXExchangeRouter.abi';
import { logger } from '../utils/logger';

type Provider = JsonRpcProvider | WebSocketProvider;

/**
 * GMXContracts manages all GMX V2 contract interactions
 */
export class GMXContracts {
  private readonly provider: Provider;
  private readonly reader: IGMXReader;
  private readonly dataStore: IGMXDataStore;
  private readonly exchangeRouter: IGMXExchangeRouter;
  private readonly addresses: GMXAddresses;

  // Referral storage address (hardcoded for Arbitrum)
  private readonly referralStorage: Address = '0xe6fab3F0c7199b0d34d7FbE83394fc0e0D06e99d';

  constructor(provider: Provider, addresses: GMXAddresses) {
    this.provider = provider;
    this.addresses = addresses;

    // Initialize contracts
    this.reader = new Contract(
      addresses.reader!,
      GMX_READER_ABI,
      provider
    ) as unknown as IGMXReader;

    this.dataStore = new Contract(
      addresses.dataStore!,
      GMX_DATASTORE_ABI,
      provider
    ) as unknown as IGMXDataStore;

    this.exchangeRouter = new Contract(
      addresses.exchangeRouter,
      GMX_EXCHANGE_ROUTER_ABI,
      provider
    ) as unknown as IGMXExchangeRouter;

    logger.info('GMXContracts initialized', {
      reader: addresses.reader,
      dataStore: addresses.dataStore,
      exchangeRouter: addresses.exchangeRouter,
      marketFactory: addresses.marketFactory,
    });
  }

  /**
   * Get the Reader contract
   */
  getReader(): IGMXReader {
    return this.reader;
  }

  /**
   * Get the DataStore contract
   */
  getDataStore(): IGMXDataStore {
    return this.dataStore;
  }

  /**
   * Get the ExchangeRouter contract
   */
  getExchangeRouter(): IGMXExchangeRouter {
    return this.exchangeRouter;
  }

  /**
   * Get the provider
   */
  getProvider(): Provider {
    return this.provider;
  }

  /**
   * Check if provider is WebSocket
   */
  isWebSocketProvider(): boolean {
    return this.provider instanceof WebSocketProvider;
  }

  /**
   * Get DataStore address
   */
  getDataStoreAddress(): Address {
    return this.addresses.dataStore!;
  }

  /**
   * Get ReferralStorage address
   */
  getReferralStorageAddress(): Address {
    return this.referralStorage;
  }

  /**
   * Get all contract addresses
   */
  getAddresses(): GMXAddresses {
    return { ...this.addresses };
  }

  /**
   * Get all markets from DataStore
   */
  async getAllMarkets(): Promise<Address[]> {
    try {
      const marketCount = await this.dataStore.getAddressCount(DATASTORE_KEYS.MARKET_LIST);

      if (marketCount === 0n) {
        logger.warn('No markets found in DataStore');
        return [];
      }

      const markets = await this.dataStore.getAddressValuesAt(
        DATASTORE_KEYS.MARKET_LIST,
        0n,
        marketCount
      );

      logger.info(`Found ${markets.length} GMX markets`);
      return markets;
    } catch (error) {
      logger.error('Failed to get markets from DataStore', { error });
      throw error;
    }
  }

  /**
   * Get market count
   */
  async getMarketCount(): Promise<number> {
    try {
      const count = await this.dataStore.getAddressCount(DATASTORE_KEYS.MARKET_LIST);
      return Number(count);
    } catch (error) {
      logger.error('Failed to get market count', { error });
      return 0;
    }
  }

  /**
   * Get position keys for an account
   */
  async getAccountPositionKeys(account: Address): Promise<string[]> {
    try {
      const positionCount = await this.dataStore.getAccountPositionCount(account);

      if (positionCount === 0n) {
        return [];
      }

      const positionKeys = await this.dataStore.getAccountPositionKeys(
        account,
        0n,
        positionCount
      );

      return positionKeys;
    } catch (error) {
      logger.error('Failed to get account position keys', { account, error });
      return [];
    }
  }

  /**
   * Get total position count across all accounts
   */
  async getTotalPositionCount(): Promise<number> {
    try {
      const count = await this.dataStore.getBytes32Count(DATASTORE_KEYS.POSITION_LIST);
      return Number(count);
    } catch (error) {
      logger.error('Failed to get total position count', { error });
      return 0;
    }
  }

  /**
   * Close WebSocket connection if using WebSocket provider
   */
  async close(): Promise<void> {
    if (this.provider instanceof WebSocketProvider) {
      try {
        await this.provider.destroy();
        logger.info('GMX WebSocket provider closed');
      } catch (error) {
        logger.error('Failed to close GMX WebSocket provider', { error });
      }
    }
  }
}

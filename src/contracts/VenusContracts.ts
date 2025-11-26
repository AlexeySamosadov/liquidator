import { Contract, JsonRpcProvider, WebSocketProvider } from 'ethers';
import { logger } from '../utils/logger';
import { Address } from '../types';
import { COMPTROLLER_ABI } from './abis/Comptroller.abi';
import { VTOKEN_ABI } from './abis/VToken.abi';
import { PRICE_ORACLE_ABI } from './abis/PriceOracle.abi';
import { LIQUIDATOR_ABI } from './abis/Liquidator.abi';
import { IComptroller, IPriceOracle, IVToken, ILiquidator } from './interfaces';
import { getVTokenForUnderlying } from '../config/vTokens';

type Provider = JsonRpcProvider | WebSocketProvider;

class VenusContracts {
  private readonly provider: Provider;

  private readonly comptroller: IComptroller;

  private oracle?: IPriceOracle;

  private liquidator?: ILiquidator | null;

  private marketsCache?: Address[];

  constructor(provider: Provider, comptrollerAddress: Address) {
    this.provider = provider;
    this.comptroller = new Contract(comptrollerAddress, COMPTROLLER_ABI, provider) as IComptroller;
  }

  /**
   * Get the underlying provider (for event subscriptions)
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

  async initialize(): Promise<void> {
    try {
      const oracleAddress = await this.comptroller.oracle();
      this.oracle = new Contract(oracleAddress, PRICE_ORACLE_ABI, this.provider) as IPriceOracle;

      let liquidatorAddress: Address | null = null;
      try {
        liquidatorAddress = await this.comptroller.liquidatorContract();
        this.liquidator = liquidatorAddress
          ? (new Contract(liquidatorAddress, LIQUIDATOR_ABI, this.provider) as ILiquidator)
          : null;
      } catch (error) {
        logger.warn('Liquidator contract not found; continuing without it', { error });
        this.liquidator = null;
      }

      logger.info('Venus contracts initialized', { oracle: oracleAddress, liquidator: liquidatorAddress });
    } catch (error) {
      logger.error('Failed to initialize Venus contracts', { error });
      throw error;
    }
  }

  getComptroller(): IComptroller {
    return this.comptroller;
  }

  getOracle(): IPriceOracle {
    if (!this.oracle) {
      throw new Error('Price oracle is not initialized yet');
    }
    return this.oracle;
  }

  getLiquidator(): ILiquidator | null {
    return this.liquidator ?? null;
  }

  getVToken(address: Address): IVToken {
    return new Contract(address, VTOKEN_ABI, this.provider) as IVToken;
  }

  getVTokenForUnderlying(underlying: Address): Address | undefined {
    return getVTokenForUnderlying(underlying);
  }

  async getAllVTokens(): Promise<Address[]> {
    if (this.marketsCache) {
      return this.marketsCache;
    }

    try {
      const markets = await this.comptroller.getAllMarkets();
      this.marketsCache = markets;
      logger.info('Loaded Venus markets', { count: markets.length });
      return markets;
    } catch (error) {
      logger.error('Failed to fetch Venus markets', { error });
      throw error;
    }
  }
}

export default VenusContracts;

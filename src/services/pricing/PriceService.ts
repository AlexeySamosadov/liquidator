import { Contract } from 'ethers';
import VenusContracts from '../../contracts';
import { Address } from '../../types';
import { logger } from '../../utils/logger';
import { COMMON_TOKENS } from '../../config/tokens';

const ORACLE_DECIMALS = 36n;
const FRACTION_SCALE = 1_000_000_000n; // 1e9 for fractional precision without floating errors

type CachedPrice = { priceUsd: number; timestamp: number };
type CachedDecimals = { decimals: number; timestamp: number };

class PriceService {
  private readonly priceCache = new Map<string, CachedPrice>();

  private readonly decimalsCache = new Map<string, CachedDecimals>();

  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly cacheTtlMs: number = 30_000,
  ) {}

  /**
   * Canonical USD price for BNB/WBNB.
   */
  async getBnbPriceUsd(): Promise<number> {
    return this.getTokenPriceUsd(COMMON_TOKENS.WBNB);
  }

  /**
   * USD price for an underlying token address. Optionally provide a vToken hint
   * to avoid resolving the market when already known.
   */
  async getTokenPriceUsd(underlying: Address, fallbackVToken?: Address): Promise<number> {
    const key = underlying.toLowerCase();
    const cached = this.getCachedPrice(key);
    if (cached !== undefined) return cached;

    const vToken = await this.resolveVTokenForUnderlying(underlying, fallbackVToken);
    if (!vToken) {
      logger.warn('PriceService: vToken not found for underlying, trying direct vToken lookup', { underlying });
      return this.getVTokenPriceUsd(underlying);
    }

    const decimals = await this.getUnderlyingDecimals(underlying);
    const priceUsd = await this.fetchPriceUsd(vToken, decimals);
    this.setCachedPrice(key, priceUsd);
    return priceUsd;
  }

  /**
   * USD price for a vToken address (uses underlying decimals when available).
   */
  async getVTokenPriceUsd(vToken: Address, underlyingDecimalsHint?: number): Promise<number> {
    const key = vToken.toLowerCase();
    const cached = this.getCachedPrice(key);
    if (cached !== undefined) return cached;

    const decimals = underlyingDecimalsHint ?? await this.getUnderlyingDecimalsForVToken(vToken);
    const priceUsd = await this.fetchPriceUsd(vToken, decimals);
    this.setCachedPrice(key, priceUsd);
    return priceUsd;
  }

  async getUnderlyingDecimals(underlying: Address): Promise<number> {
    const key = underlying.toLowerCase();
    const cached = this.decimalsCache.get(key);
    const now = Date.now();
    if (cached && now - cached.timestamp < this.cacheTtlMs) {
      return cached.decimals;
    }

    try {
      const comptrollerProvider = this.venusContracts.getComptroller().runner?.provider;
      const erc20 = new Contract(underlying, ['function decimals() view returns (uint8)'], comptrollerProvider);
      const decimals: number = await erc20.decimals();
      this.decimalsCache.set(key, { decimals, timestamp: now });
      return decimals;
    } catch (error) {
      logger.warn('PriceService: failed to fetch token decimals, defaulting to 18', { underlying, error });
      const fallback = 18;
      this.decimalsCache.set(key, { decimals: fallback, timestamp: now });
      return fallback;
    }
  }

  private getCachedPrice(key: string): number | undefined {
    const cached = this.priceCache.get(key);
    const now = Date.now();
    if (cached && now - cached.timestamp < this.cacheTtlMs) {
      return cached.priceUsd;
    }
    return undefined;
  }

  private setCachedPrice(key: string, priceUsd: number): void {
    this.priceCache.set(key, { priceUsd, timestamp: Date.now() });
  }

  private async fetchPriceUsd(vToken: Address, underlyingDecimals: number): Promise<number> {
    try {
      const priceMantissa = await this.venusContracts.getOracle().getUnderlyingPrice(vToken);
      return this.mantissaToNumber(priceMantissa, underlyingDecimals);
    } catch (error) {
      logger.warn('PriceService: failed to fetch oracle price', { vToken, error });
      return NaN;
    }
  }

  private mantissaToNumber(priceMantissa: bigint, underlyingDecimals: number): number {
    const exponent = ORACLE_DECIMALS - BigInt(underlyingDecimals);
    if (exponent < 0n) {
      // Defensive: avoid negative exponent; fallback to direct number conversion if unexpected decimals
      const price = Number(priceMantissa);
      if (!Number.isFinite(price) || priceMantissa === 0n) {
        return NaN;
      }
      return price;
    }

    const scale = 10n ** exponent;
    const integerPart = priceMantissa / scale;
    const fractionalPart = priceMantissa % scale;
    const fractionalScaled = (fractionalPart * FRACTION_SCALE) / scale;

    const price = Number(integerPart) + Number(fractionalScaled) / Number(FRACTION_SCALE);
    if (!Number.isFinite(price)) {
      return NaN;
    }
    return price;
  }

  private async resolveVTokenForUnderlying(underlying: Address, fallbackVToken?: Address): Promise<Address | null> {
    const configured = this.venusContracts.getVTokenForUnderlying(underlying);
    if (configured) return configured;
    if (fallbackVToken) return fallbackVToken;

    try {
      const markets = await this.venusContracts.getComptroller().getAllMarkets();
      for (const market of markets) {
        try {
          const vToken = this.venusContracts.getVToken(market);
          let marketUnderlying: Address;
          try {
            marketUnderlying = await vToken.underlying();
          } catch {
            continue;
          }
          if (marketUnderlying.toLowerCase() === underlying.toLowerCase()) {
            return market;
          }
        } catch (innerError) {
          logger.debug('PriceService: market iteration failed during vToken lookup', { market, error: (innerError as Error).message });
        }
      }
    } catch (error) {
      logger.warn('PriceService: failed to resolve vToken for underlying', { underlying, error });
    }
    return null;
  }

  private async getUnderlyingDecimalsForVToken(vToken: Address): Promise<number> {
    try {
      const token = this.venusContracts.getVToken(vToken);
      const underlying = await token.underlying();
      return this.getUnderlyingDecimals(underlying);
    } catch (error) {
      logger.debug('PriceService: unable to resolve underlying decimals for vToken, defaulting to 18', {
        vToken,
        error: (error as Error).message,
      });
      return 18;
    }
  }
}

export default PriceService;

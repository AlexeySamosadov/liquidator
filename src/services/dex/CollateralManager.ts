import { Contract, JsonRpcProvider, Wallet, ZeroAddress, formatUnits } from 'ethers';
import {
  COMMON_TOKENS,
  isStablecoin,
  PANCAKE_FEE_TIERS,
} from '../../config/tokens';
import {
  Address,
  BotConfig,
  CollateralSwapConfig,
  CollateralStrategy,
  LiquidationResult,
  LowercaseAddress,
  SwapResult,
  TokenConfigMap,
} from '../../types';
import TransactionBuilder from '../liquidation/TransactionBuilder';
import SwapExecutor from './SwapExecutor';
import PriceImpactChecker from './PriceImpactChecker';
import RouteOptimizer from './RouteOptimizer';
import { logger } from '../../utils/logger';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

class CollateralManager {
  private stats = {
    swapsAttempted: 0,
    swapsSucceeded: 0,
    swapsFailed: 0,
    totalUsdSwapped: 0,
    swapsSkippedInvalidPrice: 0,
  };

  private transactionBuilder: TransactionBuilder;

  private readonly tokenConfigs: TokenConfigMap;

  private readonly targetStablecoin: Address;

  constructor(
    private readonly swapExecutor: SwapExecutor,
    private readonly priceImpactChecker: PriceImpactChecker,
    private readonly routeOptimizer: RouteOptimizer,
    private readonly config: BotConfig,
    private readonly signer: Wallet,
    collateralSwapConfig: CollateralSwapConfig,
  ) {
    const provider = this.signer.provider as JsonRpcProvider;
    this.transactionBuilder = new TransactionBuilder(this.config, provider);
    const providedConfigs: TokenConfigMap = collateralSwapConfig.tokenConfigs ?? new Map();
    this.tokenConfigs = new Map(
      Array.from(providedConfigs.entries()).map(([addr, cfg]) => [addr.toLowerCase() as LowercaseAddress, cfg]),
    );
    // Choose the primary stablecoin target once so downstream logic doesn't recompute it.
    this.targetStablecoin = collateralSwapConfig.targetStablecoins?.[0]
      || this.config.preferredStablecoin
      || COMMON_TOKENS.USDT;
  }

  async handleCollateral(
    seizeToken: Address,
    seizeAmount: bigint,
    liquidationResult: LiquidationResult,
  ): Promise<SwapResult | null> {
    logger.info('Handling seized collateral', { seizeToken, seizeAmount: seizeAmount.toString(), strategy: this.config.collateralStrategy });

    try {
      if (this.config.collateralStrategy === CollateralStrategy.HOLD) {
        return null;
      }

      if (this.config.collateralStrategy === CollateralStrategy.AUTO_SELL) {
        const swap = await this.autoSellToStablecoin(seizeToken, seizeAmount);
        liquidationResult.swapResult = swap ?? undefined;
        return swap;
      }

      if (this.config.collateralStrategy === CollateralStrategy.CONFIGURABLE) {
        const swap = await this.handleConfigurableStrategy(seizeToken, seizeAmount);
        liquidationResult.swapResult = swap ?? undefined;
        return swap;
      }

      return null;
    } catch (error) {
      logger.error('Collateral handling failed', { error: (error as Error).message });
      return null;
    }
  }

  private async autoSellToStablecoin(token: Address, amount: bigint): Promise<SwapResult | null> {
    if (isStablecoin(token)) {
      logger.info('Collateral already stablecoin, no swap needed', { token });
      return {
        success: true,
        amountIn: amount,
        amountOut: amount,
        tokenIn: token,
        tokenOut: token,
      };
    }

    const decimalsIn = await this.getTokenDecimals(token);
    const price = await this.priceImpactChecker.getTokenPrice(token);

    // Validate token price before proceeding
    if (!Number.isFinite(price) || price <= 0 || price > 1000000) {
      logger.warn('Invalid token price detected, skipping swap', {
        token,
        price,
        reason: 'invalidPriceData'
      });
      return null;
    }

    const usdValue = Number.parseFloat(formatUnits(amount, decimalsIn)) * price;
    if (usdValue < this.config.minSwapAmountUsd) {
      logger.info('Skipping swap: below min USD threshold', { usdValue, min: this.config.minSwapAmountUsd });
      return null;
    }

    const target = this.targetStablecoin;
    const route = await this.routeOptimizer.findBestRoute(token, target, amount);
    if (!route.path.length) {
      logger.warn('No swap route found for collateral', { token, target });
      return null;
    }

    const tokenInPrice = await this.priceImpactChecker.getTokenPrice(token);
    const tokenOutPrice = await this.priceImpactChecker.getTokenPrice(target);

    // Validate token prices before proceeding
    if (!Number.isFinite(tokenInPrice) || tokenInPrice <= 0 || tokenInPrice > 1000000) {
      logger.warn('Invalid input token price detected, skipping swap', {
        token,
        tokenInPrice,
        reason: 'invalidPriceData'
      });
      return null;
    }

    if (!Number.isFinite(tokenOutPrice) || tokenOutPrice <= 0 || tokenOutPrice > 1000000) {
      logger.warn('Invalid output token price detected, skipping swap', {
        target,
        tokenOutPrice,
        reason: 'invalidPriceData'
      });
      return null;
    }
    const minOut = await this.priceImpactChecker.calculateMinAmountOut(amount, tokenInPrice, tokenOutPrice, token, target);

    const expectedOut = route.expectedOut || await this.routeOptimizer.estimateMultiHopOutput(route.path, route.fees, amount);
    const impactCheck = await this.priceImpactChecker.checkPriceImpact(token, target, amount, expectedOut);
    if (!impactCheck.isAcceptable) {
      logger.warn('Price impact too high, aborting swap', { impact: impactCheck.impactPercent });
      return null;
    }

    const gasParams = await this.transactionBuilder.buildGasParams();
    this.stats.swapsAttempted += 1;

    let swapResult: SwapResult;
    if (route.path.length === 2) {
      swapResult = await this.swapExecutor.executeSingleHopSwap({
        path: route.path,
        amountIn: amount,
        amountOutMin: minOut,
        fee: route.fees[0] ?? PANCAKE_FEE_TIERS.MEDIUM,
        deadline: Math.floor(Date.now() / 1000) + 300,
        recipient: this.signer.address,
      }, gasParams);
    } else {
      swapResult = await this.swapExecutor.executeMultiHopSwap(
        route.path,
        route.fees,
        amount,
        minOut,
        gasParams,
        this.signer.address,
      );
    }

    const enriched = this.priceImpactChecker.enrichSwapResultWithImpact(swapResult, expectedOut);

    if (enriched.success) {
      this.stats.swapsSucceeded += 1;
      this.stats.totalUsdSwapped += usdValue;
    } else {
      this.stats.swapsFailed += 1;
    }

    return enriched;
  }

  private async handleConfigurableStrategy(token: Address, amount: bigint): Promise<SwapResult | null> {
    const config = this.tokenConfigs.get(token.toLowerCase() as LowercaseAddress);
    if (!config) {
      return this.autoSellToStablecoin(token, amount);
    }

    if (!config.autoSell) {
      logger.info('Configured to hold token', { token, symbol: config.symbol });
      return null;
    }

    const decimalsIn = await this.getTokenDecimals(token);
    const tokenInPrice = await this.priceImpactChecker.getTokenPrice(token);

    // Validate token price before proceeding
    if (!Number.isFinite(tokenInPrice) || tokenInPrice <= 0 || tokenInPrice > 1000000) {
      logger.warn('Invalid input token price detected, skipping swap', {
        token,
        tokenInPrice,
        reason: 'invalidPriceData'
      });
      return null;
    }

    const usdValue = Number.parseFloat(formatUnits(amount, decimalsIn)) * tokenInPrice;
    if (usdValue < this.config.minSwapAmountUsd) {
      logger.info('Skipping swap: below min USD threshold', { usdValue, min: this.config.minSwapAmountUsd });
      return null;
    }

    const target = this.targetStablecoin;
    const path = config.preferredSwapPath ?? [token, target];
    const fees = new Array(path.length - 1).fill(PANCAKE_FEE_TIERS.MEDIUM);
    const tokenOutPrice = await this.priceImpactChecker.getTokenPrice(target);

    // Validate target token price
    if (!Number.isFinite(tokenOutPrice) || tokenOutPrice <= 0 || tokenOutPrice > 1000000) {
      logger.warn('Invalid output token price detected, skipping swap', {
        target,
        tokenOutPrice,
        reason: 'invalidPriceData'
      });
      return null;
    }
    const minOut = await this.priceImpactChecker.calculateMinAmountOut(amount, tokenInPrice, tokenOutPrice, token, target);
    const expectedOut = await this.routeOptimizer.estimateMultiHopOutput(path, fees, amount);
    const impact = await this.priceImpactChecker.checkPriceImpact(token, target, amount, expectedOut);
    if (!impact.isAcceptable) {
      logger.warn('Configurable strategy blocked by price impact', { token, impact: impact.impactPercent });
      return null;
    }

    const gasParams = await this.transactionBuilder.buildGasParams();
    this.stats.swapsAttempted += 1;
    const swapResult = path.length === 2
      ? await this.swapExecutor.executeSingleHopSwap({
        path,
        amountIn: amount,
        amountOutMin: minOut,
        fee: fees[0],
        deadline: Math.floor(Date.now() / 1000) + 300,
        recipient: this.signer.address,
      }, gasParams)
      : await this.swapExecutor.executeMultiHopSwap(path, fees, amount, minOut, gasParams, this.signer.address);

    if (swapResult.success) {
      this.stats.swapsSucceeded += 1;
      const usdValue = Number.parseFloat(formatUnits(amount, decimalsIn)) * tokenInPrice;
      this.stats.totalUsdSwapped += usdValue;
    } else {
      this.stats.swapsFailed += 1;
    }
    const enriched = this.priceImpactChecker.enrichSwapResultWithImpact(swapResult, expectedOut);
    return enriched;
  }

  async getCollateralBalance(token: Address): Promise<bigint> {
    if (token === ZeroAddress) {
      return (this.signer.provider as JsonRpcProvider).getBalance(this.signer.address);
    }

    const erc20 = new Contract(token, ERC20_ABI, this.signer.provider);
    const balance: bigint = await erc20.balanceOf(this.signer.address);
    return balance;
  }

  getStats() {
    return this.stats;
  }

  protected async getTokenDecimals(token: Address): Promise<number> {
    try {
      const erc20 = new Contract(token, ERC20_ABI, this.signer.provider);
      const decimals: number = await erc20.decimals();
      return decimals;
    } catch (error) {
      logger.warn('Failed to fetch token decimals, defaulting to 18', { token, error: (error as Error).message });
      return 18;
    }
  }
}

export default CollateralManager;

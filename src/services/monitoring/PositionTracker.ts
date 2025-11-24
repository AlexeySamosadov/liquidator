import {
  Address,
  LiquidatablePosition,
  PositionTrackerStats,
  TokenPositionDetail,
  VenusPosition,
} from '../../types';
import { logger } from '../../utils/logger';
import HealthFactorCalculator from './HealthFactorCalculator';
import PriceService from '../pricing/PriceService';

class PositionTracker {
  private readonly positions = new Map<string, VenusPosition>();

  private readonly liquidatablePositions = new Map<string, LiquidatablePosition>();

  constructor(
    private readonly healthFactorCalculator: HealthFactorCalculator,
    private readonly priceService: PriceService,
    private readonly minHealthFactor: number,
    private readonly minPositionSizeUsd: number,
    private readonly gasCostEstimator?: (position: VenusPosition | LiquidatablePosition) => Promise<number>,
  ) {}

  async updatePosition(position: VenusPosition): Promise<void> {
    const key = position.borrower.toLowerCase();

    if (position.debtValueUsd === 0 && position.healthFactor >= this.minHealthFactor) {
      this.positions.delete(key);
      this.liquidatablePositions.delete(key);
      return;
    }

    this.positions.set(key, position);

    const liquidatable = this.healthFactorCalculator.isLiquidatable(position, this.minPositionSizeUsd);
    if (liquidatable && position.healthFactor < this.minHealthFactor) {
      const details = await this.calculateLiquidationDetails(position);
      if (!details) {
        logger.warn('Skipping liquidatable position due to invalid calculated values', { borrower: position.borrower });
        this.liquidatablePositions.delete(key);
        return;
      }
      this.liquidatablePositions.set(key, details);
      logger.info('Position became liquidatable', {
        borrower: position.borrower,
        healthFactor: position.healthFactor,
        debtUsd: position.debtValueUsd,
        profitUsd: details.estimatedProfitUsd,
      });
    } else if (!liquidatable && this.liquidatablePositions.has(key)) {
      this.liquidatablePositions.delete(key);
      logger.info('Position recovered above threshold', { borrower: position.borrower });
    }
  }

  getLiquidatablePositions(): LiquidatablePosition[] {
    const positions = Array.from(this.liquidatablePositions.values()).filter(
      (pos) => pos.debtValueUsd >= this.minPositionSizeUsd,
    );

    return positions.sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);
  }

  getPosition(borrower: Address): VenusPosition | undefined {
    return this.positions.get(borrower.toLowerCase());
  }

  getAllPositions(): VenusPosition[] {
    return Array.from(this.positions.values());
  }

  getStats(): PositionTrackerStats {
    const totalAccountsTracked = this.positions.size;
    const liquidatablePositions = this.liquidatablePositions.size;
    const averageHealthFactor = this.calculateAverageHealthFactor();

    return {
      totalAccountsTracked,
      liquidatablePositions,
      averageHealthFactor,
    };
  }

  clear(): void {
    this.positions.clear();
    this.liquidatablePositions.clear();
  }

  private async calculateLiquidationDetails(position: VenusPosition): Promise<LiquidatablePosition | null> {
    const bestBorrow = this.pickHighestValue(position.borrowDetails ?? []);
    const bestCollateral = this.pickHighestValue(position.collateralDetails ?? []);

    const repayAmountRaw = bestBorrow ? bestBorrow.amount / 2n : 0n;
    const repayToken = bestBorrow ? bestBorrow.vToken : position.borrowTokens[0];
    const seizeToken = bestCollateral ? bestCollateral.vToken : position.collateralTokens[0];

    const repayTokenDecimals = bestBorrow?.decimals ?? 18;
    const repayTokenPriceUsd = await this.resolveRepayTokenPriceUsd(bestBorrow);

    const repayAmountHuman = this.normalizeAmount(repayAmountRaw, repayTokenDecimals);
    const repayAmountUsd = repayTokenPriceUsd !== undefined
      ? repayAmountHuman * repayTokenPriceUsd
      : bestBorrow ? bestBorrow.valueUsd / 2 : position.debtValueUsd / 2;

    if (!Number.isFinite(repayAmountUsd)) {
      logger.error('Non-finite repay amount USD derived', {
        borrower: position.borrower,
        repayAmountUsd,
        repayToken,
        repayTokenPriceUsd,
        repayAmountHuman,
      });
      return null;
    }

    let estimatedGasUsd = 0.1;
    if (this.gasCostEstimator) {
      try {
        estimatedGasUsd = await this.gasCostEstimator(position);
      } catch (error) {
        logger.warn('Failed to estimate gas cost for ranking; using fallback', { error });
      }
    }

    let incentive = 1.1;
    try {
      incentive = await this.healthFactorCalculator.getLiquidationIncentive();
    } catch (error) {
      logger.warn('Failed to fetch liquidation incentive, using fallback', { error });
    }

    const estimatedProfitUsd = Number.isFinite(repayAmountUsd)
      ? repayAmountUsd * (incentive - 1) - estimatedGasUsd
      : -estimatedGasUsd;

    if (!Number.isFinite(estimatedProfitUsd)) {
      logger.error('Non-finite estimated profit derived', {
        borrower: position.borrower,
        estimatedProfitUsd,
        repayAmountUsd,
        incentive,
        estimatedGasUsd,
      });
      return null;
    }

    return {
      ...position,
      repayToken: repayToken ?? position.borrower,
      repayAmount: repayAmountRaw,
      seizeToken: seizeToken ?? position.borrower,
      repayTokenDecimals: repayTokenDecimals,
      repayTokenPriceUsd: bestBorrow && bestBorrow.amount > 0n ? repayTokenPriceUsd : undefined,
      estimatedProfitUsd,
      lastUpdated: Date.now(),
    };
  }

  private pickHighestValue(details: TokenPositionDetail[]): TokenPositionDetail | undefined {
    if (details.length === 0) return undefined;
    return details.reduce((max, current) => (current.valueUsd > max.valueUsd ? current : max), details[0]);
  }

  private calculateAverageHealthFactor(): number {
    if (this.positions.size === 0) return 0;
    const sum = Array.from(this.positions.values()).reduce((acc, pos) => acc + (pos.healthFactor || 0), 0);
    return sum / this.positions.size;
  }

  private async resolveRepayTokenPriceUsd(bestBorrow?: TokenPositionDetail): Promise<number | undefined> {
    if (!bestBorrow) return undefined;

    if (bestBorrow.underlying) {
      const underlyingPrice = await this.priceService.getTokenPriceUsd(
        bestBorrow.underlying,
        bestBorrow.vToken,
      );
      if (underlyingPrice > 0) {
        return underlyingPrice;
      }
    }

    const vTokenPrice = await this.priceService.getVTokenPriceUsd(bestBorrow.vToken, bestBorrow.decimals);
    if (vTokenPrice > 0) {
      return vTokenPrice;
    }

    return this.derivePriceFromPosition(bestBorrow);
  }

  private derivePriceFromPosition(position: TokenPositionDetail): number | undefined {
    if (position.amount === 0n || !Number.isFinite(position.valueUsd)) return undefined;

    const priceScale = 100_000_000n; // 1e8 precision for derived price
    const scaledValueNumber = Math.round(position.valueUsd * Number(priceScale));
    if (!Number.isFinite(scaledValueNumber)) return undefined;

    const valueUsdScaled = BigInt(scaledValueNumber);
    const tokenScale = 10n ** BigInt(position.decimals);
    const priceScaled = (valueUsdScaled * tokenScale) / position.amount;

    return Number(priceScaled) / Number(priceScale);
  }

  private normalizeAmount(amount: bigint, decimals: number): number {
    const scale = 10n ** BigInt(decimals);
    const integerPart = amount / scale;
    const fractionalPart = amount % scale;
    const fractionalScaled = (fractionalPart * 1_000_000n) / scale;
    return Number(integerPart) + Number(fractionalScaled) / 1_000_000;
  }
}

export default PositionTracker;

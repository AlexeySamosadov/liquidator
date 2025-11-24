import { Address, VenusPosition } from '../../src/types';
import { createVenusPosition } from '../utils/positionFactory';

export class MockHealthFactorCalculator {
  private healthFactors = new Map<string, number>();

  private positions = new Map<string, VenusPosition>();

  private defaultHealthFactor = 1.5;

  private liquidationIncentive = 1.08;

  private errorAccounts = new Set<string>();

  private calculateHistory: Address[] = [];

  private detailsHistory: Address[] = [];

  private isLiquidatableHistory: Array<{ position: VenusPosition; minPositionSizeUsd: number }> = [];

  async calculateHealthFactor(account: Address): Promise<number> {
    const key = account.toLowerCase();
    this.calculateHistory.push(account);
    if (this.errorAccounts.has(key)) return Number.NaN;
    return this.healthFactors.get(key) ?? this.defaultHealthFactor;
  }

  async getPositionDetails(account: Address): Promise<VenusPosition> {
    const key = account.toLowerCase();
    this.detailsHistory.push(account);
    if (this.errorAccounts.has(key)) {
      return { ...createVenusPosition({ borrower: account }), healthFactor: Number.NaN };
    }
    const position = this.positions.get(key) ?? createVenusPosition({ borrower: account, healthFactor: this.defaultHealthFactor });
    return position;
  }

  isLiquidatable(position: VenusPosition, minPositionSizeUsd: number): boolean {
    this.isLiquidatableHistory.push({ position, minPositionSizeUsd });
    if (!Number.isFinite(position.healthFactor)) return false;
    return position.healthFactor < 1.0 && position.debtValueUsd >= minPositionSizeUsd;
  }

  async getLiquidationIncentive(): Promise<number> {
    return this.liquidationIncentive;
  }

  setHealthFactor(account: Address, hf: number): void {
    this.healthFactors.set(account.toLowerCase(), hf);
  }

  setDefaultHealthFactor(hf: number): void {
    this.defaultHealthFactor = hf;
  }

  setPosition(account: Address, position: VenusPosition): void {
    this.positions.set(account.toLowerCase(), position);
  }

  setLiquidationIncentive(incentive: number): void {
    this.liquidationIncentive = incentive;
  }

  mockCalculationError(account: Address): void {
    this.errorAccounts.add(account.toLowerCase());
  }

  getCalculateHistory(): Address[] {
    return this.calculateHistory;
  }

  getDetailsHistory(): Address[] {
    return this.detailsHistory;
  }

  getIsLiquidatableHistory(): Array<{ position: VenusPosition; minPositionSizeUsd: number }> {
    return this.isLiquidatableHistory;
  }
}

export default MockHealthFactorCalculator;

import { Address, LiquidatablePosition, PositionTrackerStats, VenusPosition } from '../../src/types';

export class MockPositionTracker {
  private positions = new Map<string, VenusPosition>();

  private liquidatable = new Map<string, LiquidatablePosition>();

  private updateHistory: VenusPosition[] = [];

  private updateError = false;

  private statsOverride: PositionTrackerStats | null = null;

  constructor(private readonly minPositionSizeUsd: number = 0) {}

  async updatePosition(position: VenusPosition): Promise<void> {
    if (this.updateError) throw new Error('Mock update error');
    const key = position.borrower.toLowerCase();
    this.updateHistory.push(position);
    this.positions.set(key, position);

    if (position.healthFactor < 1 && position.debtValueUsd >= this.minPositionSizeUsd && Number.isFinite(position.healthFactor)) {
      const liquid: LiquidatablePosition = {
        ...(position as LiquidatablePosition),
        repayToken: (position as any).repayToken ?? position.borrowTokens[0] ?? position.borrower,
        seizeToken: (position as any).seizeToken ?? position.collateralTokens[0] ?? position.borrower,
        repayAmount: (position as any).repayAmount ?? 0n,
        estimatedProfitUsd: (position as any).estimatedProfitUsd ?? 0,
        lastUpdated: (position as any).lastUpdated ?? Date.now(),
      };
      this.liquidatable.set(key, liquid);
    } else {
      this.liquidatable.delete(key);
    }
  }

  getLiquidatablePositions(): LiquidatablePosition[] {
    return Array.from(this.liquidatable.values()).sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);
  }

  getPosition(borrower: Address): VenusPosition | undefined {
    return this.positions.get(borrower.toLowerCase());
  }

  getAllPositions(): VenusPosition[] {
    return Array.from(this.positions.values());
  }

  getStats(): PositionTrackerStats {
    if (this.statsOverride) return this.statsOverride;
    const totalAccountsTracked = this.positions.size;
    const liquidatablePositions = this.liquidatable.size;
    const averageHealthFactor = totalAccountsTracked === 0
      ? 0
      : Array.from(this.positions.values()).reduce((acc, pos) => acc + (pos.healthFactor || 0), 0) / totalAccountsTracked;
    return { totalAccountsTracked, liquidatablePositions, averageHealthFactor };
  }

  clear(): void {
    this.positions.clear();
    this.liquidatable.clear();
    this.updateHistory = [];
  }

  addPosition(position: VenusPosition): void {
    this.positions.set(position.borrower.toLowerCase(), position);
  }

  addLiquidatablePosition(position: LiquidatablePosition): void {
    this.liquidatable.set(position.borrower.toLowerCase(), position);
  }

  setStats(stats: PositionTrackerStats): void {
    this.statsOverride = stats;
  }

  mockUpdateError(): void {
    this.updateError = true;
  }

  getUpdateHistory(): VenusPosition[] {
    return this.updateHistory;
  }

  getCallCount(method: 'updatePosition' | 'getLiquidatablePositions' | 'getStats'): number {
    switch (method) {
      case 'updatePosition':
        return this.updateHistory.length;
      case 'getLiquidatablePositions':
        return this.liquidatable.size;
      case 'getStats':
        return this.statsOverride ? 1 : 0;
      default:
        return 0;
    }
  }
}

export default MockPositionTracker;

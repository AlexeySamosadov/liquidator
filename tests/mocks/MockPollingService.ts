import { Address, VenusPosition } from '../../src/types';

export class MockPollingService {
  private accounts = new Set<string>();

  private running = false;

  private pollError = false;

  private startError = false;

  private stats = { accountsTracked: 0, lastPoll: 0 };

  private addHistory: Address[] = [];

  private pollCount = 0;

  private startCount = 0;

  private stopCount = 0;

  private pollingIntervalMs = 0;

  constructor(private onPositionUpdate?: (position: VenusPosition) => Promise<void> | void) {}

  setOnPositionUpdate(cb: (position: VenusPosition) => Promise<void> | void): void {
    this.onPositionUpdate = cb;
  }

  addAccount(account: Address): void {
    const key = account.toLowerCase();
    this.accounts.add(key);
    this.addHistory.push(account);
    this.stats.accountsTracked = this.accounts.size;
  }

  addAccounts(accounts: Address[]): void {
    accounts.forEach((a) => this.addAccount(a));
  }

  markAccountResolved(account: Address): void {
    this.accounts.delete(account.toLowerCase());
    this.stats.accountsTracked = this.accounts.size;
  }

  markAccountHealthy(account: Address): void {
    this.markAccountResolved(account);
  }

  setAccounts(accounts: Address[]): void {
    this.accounts = new Set(accounts.map((a) => a.toLowerCase()));
    this.stats.accountsTracked = this.accounts.size;
  }

  setStats(stats: { accountsTracked: number; lastPoll: number }): void {
    this.stats = stats;
  }

  setPollingInterval(ms: number): void {
    this.pollingIntervalMs = ms;
  }

  mockPollError(): void {
    this.pollError = true;
  }

  mockStartError(): void {
    this.startError = true;
  }

  async start(): Promise<void> {
    this.startCount += 1;
    if (this.startError) throw new Error('Mock polling start error');
    this.running = true;
    this.pollingIntervalMs = this.pollingIntervalMs || 0;
  }

  stop(): void {
    this.stopCount += 1;
    this.running = false;
  }

  async poll(): Promise<void> {
    this.pollCount += 1;
    if (this.pollError) throw new Error('Mock poll error');
    const now = Date.now();
    this.stats.lastPoll = now;
    for (const account of this.accounts) {
      if (!this.onPositionUpdate) continue;
      const position: VenusPosition = {
        borrower: account,
        healthFactor: 1.0,
        collateralValueUsd: 0,
        debtValueUsd: 0,
        collateralTokens: [],
        borrowTokens: [],
        collateralDetails: [],
        borrowDetails: [],
        accountLiquidity: { error: 0n, liquidity: 0n, shortfall: 0n },
      };
      await this.onPositionUpdate(position);
    }
  }

  getStats(): { accountsTracked: number; lastPoll: number } {
    return this.stats;
  }

  getAddAccountHistory(): Address[] {
    return this.addHistory;
  }

  getPollCallCount(): number {
    return this.pollCount;
  }

  getStartCallCount(): number {
    return this.startCount;
  }

  getStopCallCount(): number {
    return this.stopCount;
  }

  isRunning(): boolean {
    return this.running;
  }
}

export default MockPollingService;

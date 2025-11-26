import { Address, VenusPosition } from '../../types';
import { logger } from '../../utils/logger';
import HealthFactorCalculator from './HealthFactorCalculator';

class PollingService {
  private readonly accounts = new Set<string>();

  private readonly accountMetadata = new Map<string, { healthyPolls: number; lastPosition?: VenusPosition }>();

  private intervalId: NodeJS.Timeout | null = null;

  private isRunning = false;

  private lastPollTimestamp = 0;
  private pollCursor = 0;

  // Telemetry counters
  private pollCount = 0;
  private totalAccountsPolled = 0;
  private failedPolls = 0;
  private successfulPositionUpdates = 0;
  private lastPollStartTime = 0;

  constructor(
    private readonly healthFactorCalculator: HealthFactorCalculator,
    private readonly pollingIntervalMs: number,
    private readonly minHealthFactor: number,
    private readonly onPositionUpdate: (position: VenusPosition) => Promise<void>,
    private readonly healthyPollsBeforeDrop = 3,
    private readonly maxAccountsPerPoll = 0,
  ) {}

  addAccount(account: Address): void {
    const key = account.toLowerCase();
    this.accounts.add(key);
    if (!this.accountMetadata.has(key)) {
      this.accountMetadata.set(key, { healthyPolls: 0 });
    }
    logger.debug('Account added to polling set', { account });
  }

  addAccounts(accounts: Address[]): void {
    accounts.forEach((account) => this.addAccount(account));
  }

  markAccountResolved(account: Address): void {
    const key = account.toLowerCase();
    const removed = this.accounts.delete(key);
    this.accountMetadata.delete(key);
    if (this.pollCursor >= this.accounts.size) {
      this.pollCursor = 0;
    }
    if (removed) {
      logger.info('Account removed from polling set', { account });
    }
  }

  markAccountHealthy(account: Address, consecutivePolls = this.healthyPollsBeforeDrop): void {
    const key = account.toLowerCase();
    if (!this.accounts.has(key)) return;

    const meta = this.accountMetadata.get(key) ?? { healthyPolls: 0 };
    meta.healthyPolls = Math.max(meta.healthyPolls, consecutivePolls);
    this.accountMetadata.set(key, meta);

    if (meta.healthyPolls >= consecutivePolls) {
      this.markAccountResolved(account);
    }
  }

  start(): void {
    if (this.isRunning) return;

    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.pollingIntervalMs);

    void this.poll();
    this.isRunning = true;
    logger.info('Polling service started', { intervalMs: this.pollingIntervalMs });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.intervalId = null;
    this.isRunning = false;
    logger.info('Polling service stopped');
  }

  async poll(): Promise<void> {
    if (this.accounts.size === 0) {
      return;
    }

    const startTime = Date.now();
    this.lastPollStartTime = startTime;

    const accounts = this.getAccountsBatch();
    if (accounts.length === 0) return;

    logger.debug('Polling accounts for health factor', {
      total: this.accounts.size,
      batchSize: accounts.length,
      totalPolled: this.totalAccountsPolled,
      pollCount: this.pollCount,
    });

    const results = await Promise.allSettled(
      accounts.map(async (account) => {
        const position = await this.healthFactorCalculator.getPositionDetails(account);
        await this.onPositionUpdate(position);
        this.trackAccountState(account, position);
      }),
    );

    let successfulUpdates = 0;
    results.forEach((res, idx) => {
      if (res.status === 'rejected') {
        logger.warn('Polling failed for account', { account: accounts[idx], error: res.reason });
        this.failedPolls++;
      } else {
        successfulUpdates++;
      }
    });

    this.successfulPositionUpdates += successfulUpdates;
    this.totalAccountsPolled += accounts.length;
    this.pollCount++;

    const pollDuration = Date.now() - startTime;
    logger.info('Polling completed', {
      batchSize: accounts.length,
      totalAccounts: this.accounts.size,
      successfulUpdates,
      failedUpdates: accounts.length - successfulUpdates,
      pollDurationMs: pollDuration,
      avgSuccessRate: successfulUpdates / Math.max(accounts.length, 1),
      totalSuccessfulUpdates: this.successfulPositionUpdates,
    });

    this.lastPollTimestamp = Date.now();
  }

  getStats(): {
    accountsTracked: number;
    lastPoll: number;
    totalPolled: number;
    pollCount: number;
    failedPolls: number;
    successfulUpdates: number;
    avgPollDurationMs: number;
    avgSuccessRate: number;
  } {
    const successRate = this.pollCount > 0 ? this.successfulPositionUpdates / this.totalAccountsPolled : 0;
    const avgPollDuration = this.pollCount > 0 && this.lastPollStartTime > 0
      ? (this.lastPollTimestamp - this.lastPollStartTime) / this.pollCount
      : 0;

    return {
      accountsTracked: this.accounts.size,
      lastPoll: this.lastPollTimestamp,
      totalPolled: this.totalAccountsPolled,
      pollCount: this.pollCount,
      failedPolls: this.failedPolls,
      successfulUpdates: this.successfulPositionUpdates,
      avgPollDurationMs: avgPollDuration,
      avgSuccessRate: successRate,
    };
  }

  private trackAccountState(account: Address, position: VenusPosition): void {
    const key = account.toLowerCase();
    const meta = this.accountMetadata.get(key) ?? { healthyPolls: 0 };
    meta.lastPosition = position;

    const isHealthyAndFlat = position.debtValueUsd === 0 && position.healthFactor >= this.minHealthFactor;
    if (isHealthyAndFlat) {
      meta.healthyPolls += 1;
      if (meta.healthyPolls >= this.healthyPollsBeforeDrop) {
        this.markAccountResolved(account);
        return;
      }
    } else {
      meta.healthyPolls = 0;
    }

    this.accountMetadata.set(key, meta);
  }

  private getAccountsBatch(): string[] {
    const accounts = Array.from(this.accounts.values());
    if (accounts.length === 0) return [];

    if (this.maxAccountsPerPoll <= 0 || accounts.length <= this.maxAccountsPerPoll) {
      this.pollCursor = 0;
      return accounts;
    }

    if (this.pollCursor >= accounts.length) {
      this.pollCursor = 0;
    }

    const end = Math.min(this.pollCursor + this.maxAccountsPerPoll, accounts.length);
    const batch = accounts.slice(this.pollCursor, end);
    this.pollCursor = end >= accounts.length ? 0 : end;
    return batch;
  }
}

export default PollingService;

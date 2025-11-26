import {
  BotConfig,
  ExecutionConfig,
  ExecutionStats,
  LiquidatablePosition,
  LowercaseAddress,
  PositionKey,
  RetryState,
} from '../../types';
import { logger } from '../../utils/logger';
import MonitoringService from '../monitoring/MonitoringService';
import LiquidationEngine from '../liquidation/LiquidationEngine';

class ExecutionService {
  private interval: NodeJS.Timeout | null = null;

  private running = false;

  private tickInProgress = false;

  private shuttingDown = false;

  private paused = false;

  private retryStates: Map<PositionKey, RetryState> = new Map();

  private cooldowns: Map<PositionKey, number> = new Map();

  private stats: ExecutionStats = {
    isRunning: false,
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    retriedExecutions: 0,
    skippedDueToEmergencyStop: 0,
    skippedDueToCooldown: 0,
    skippedDueToBackoff: 0,
    positionsInRetry: 0,
    positionsInCooldown: 0,
    lastExecutionTimestamp: 0,
    totalExecutionTimeMs: 0,
    averageExecutionTimeMs: 0,
  };

  constructor(
    private readonly monitoringService: MonitoringService | null,
    private readonly liquidationEngine: LiquidationEngine,
    private readonly config: BotConfig,
  ) {}

  start(): void {
    if (this.running) return;

    // Always reset pause state on a fresh start so execution resumes.
    this.paused = false;
    const executionConfig = this.getExecutionConfig();
    this.interval = setInterval(() => this.tick(), executionConfig.intervalMs);
    this.running = true;
    this.stats.isRunning = true;
    logger.info('Execution service started', {
      intervalMs: executionConfig.intervalMs,
      maxRetries: executionConfig.maxRetries,
      baseRetryDelayMs: executionConfig.baseRetryDelayMs,
      successCooldownMs: executionConfig.successCooldownMs,
      paused: this.paused,
    });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Reset pause state on stop to ensure the next start is clean.
    this.paused = false;
    this.running = false;
    this.stats.isRunning = false;
    // Clear transient state so each start begins fresh without lingering cooldowns/backoffs.
    // This is intentional; revisit if stop()/start() cycles need to preserve state within a process.
    this.retryStates.clear();
    this.cooldowns.clear();
    this.stats.positionsInRetry = 0;
    this.stats.positionsInCooldown = 0;
    logger.info('Execution service stopped', {
      totalExecutions: this.stats.totalExecutions,
      successfulExecutions: this.stats.successfulExecutions,
    });
  }

  pause(): void {
    // Pausing intentionally leaves retry/backoff state intact; resume() will honor existing cooldowns.
    this.paused = true;
    logger.info('Execution service paused');
  }

  resume(): void {
    // Resume does not clear retry/backoff; use stop()/start() for a fresh run without history.
    this.paused = false;
    logger.info('Execution service resumed');
  }

  isRunning(): boolean {
    return this.running;
  }

  getStats(): ExecutionStats {
    const now = Date.now();
    this.cleanupCooldowns(now);
    this.cleanupRetries(now);

    // Average across all execution attempts (successes and failures).
    const averageExecutionTimeMs = this.stats.totalExecutions > 0
      ? this.stats.totalExecutionTimeMs / this.stats.totalExecutions
      : 0;

    this.stats.averageExecutionTimeMs = averageExecutionTimeMs;

    return {
      ...this.stats,
      positionsInRetry: this.retryStates.size,
      positionsInCooldown: this.cooldowns.size,
      averageExecutionTimeMs,
    };
  }

  private async tick(): Promise<void> {
    if (this.tickInProgress) {
      logger.warn('Execution tick already in progress, skipping');
      return;
    }

    if (this.shuttingDown) {
      logger.debug('Execution tick skipped: service is shutting down');
      return;
    }

    if (this.paused) {
      logger.debug('Execution tick skipped: service is paused');
      return;
    }

    this.tickInProgress = true;
    const now = Date.now();
    this.stats.lastExecutionTimestamp = now;

    try {
      const emergency = this.liquidationEngine.getEmergencyStopState();
      if (emergency?.isActive) {
        this.stats.skippedDueToEmergencyStop += 1;
        logger.warn('Emergency stop active, skipping execution iteration', {
          reason: emergency.reason,
          activatedAt: emergency.activatedAt,
        });
        return;
      }

      this.cleanupCooldowns(now);
      this.cleanupRetries(now);

      const positions = this.monitoringService ? this.monitoringService.getLiquidatablePositions() : [];
      if (!positions.length) {
        return;
      }

      const skippedCooldownBorrowers = new Set<PositionKey>();
      const skippedBackoffBorrowers = new Set<PositionKey>();

      const available = positions.filter((position) => (
        this.isPositionEligible(position, now, skippedCooldownBorrowers, skippedBackoffBorrowers)
      ));
      if (!available.length) {
        return;
      }

      const sorted = available.sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);
      const target = sorted[0];

      const canExecute = await this.liquidationEngine.canExecute(target);
      if (!canExecute) {
        logger.debug('Position not executable after validation', { borrower: target.borrower });
        return;
      }

      await this.executePosition(target, now);
    } catch (error) {
      logger.error('Execution loop iteration failed', { error: (error as Error).message });
    } finally {
      const afterTickNow = Date.now();
      this.cleanupCooldowns(afterTickNow);
      this.cleanupRetries(afterTickNow);
      this.tickInProgress = false;
      this.stats.positionsInRetry = this.retryStates.size;
      this.stats.positionsInCooldown = this.cooldowns.size;
    }
  }

  private async executePosition(position: LiquidatablePosition, now: number): Promise<void> {
    this.stats.totalExecutions += 1;
    const lowercaseBorrower = position.borrower.toLowerCase() as LowercaseAddress;
    const positionKey = this.getPositionKey(position);
    const executionConfig = this.getExecutionConfig();

    const startTime = Date.now();
    try {
      const result = await this.liquidationEngine.executeLiquidation(position);
      const executionTime = Date.now() - startTime;
      this.stats.totalExecutionTimeMs += executionTime;

      if (result.success) {
        this.stats.successfulExecutions += 1;
        this.retryStates.delete(positionKey);
        if (executionConfig.successCooldownMs > 0) {
          this.cooldowns.set(positionKey, now + executionConfig.successCooldownMs);
        }
        logger.info('Liquidation executed successfully', {
          borrower: position.borrower,
          profitUsd: result.profitUsd ?? position.estimatedProfitUsd,
          executionTimeMs: executionTime,
        });
        return;
      }

      this.stats.failedExecutions += 1;
      this.scheduleRetry(positionKey, lowercaseBorrower, result.error);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.stats.totalExecutionTimeMs += executionTime;
      this.stats.failedExecutions += 1;
      const errorMessage = (error as Error).message;
      logger.error('Liquidation execution threw', {
        borrower: position.borrower,
        executionTimeMs: executionTime,
        error: errorMessage,
      });
      this.scheduleRetry(positionKey, lowercaseBorrower, errorMessage);
    }
  }

  private scheduleRetry(positionKey: PositionKey, lowercaseBorrower: LowercaseAddress, error?: string): void {
    const executionConfig = this.getExecutionConfig();
    const previous = this.retryStates.get(positionKey);
    const retryCount = (previous?.retryCount ?? 0) + 1;

    if (retryCount > executionConfig.maxRetries) {
      this.retryStates.delete(positionKey);
      logger.error('Liquidation permanently failed after max retries', {
        borrower: lowercaseBorrower,
        retryCount,
        error,
      });
      return;
    }

    const delay = Math.min(
      executionConfig.baseRetryDelayMs * 2 ** (retryCount - 1),
      executionConfig.maxRetryDelayMs,
    );
    const nextRetryAt = Date.now() + delay;

    const retryState: RetryState = {
      positionKey,
      borrower: lowercaseBorrower,
      retryCount,
      nextRetryAt,
      lastError: error,
    };

    this.retryStates.set(positionKey, retryState);
    this.stats.retriedExecutions += 1;
    logger.warn('Liquidation failed, scheduling retry with backoff', {
      borrower: lowercaseBorrower,
      retryCount,
      nextRetryInMs: delay,
      nextRetryAt,
      error,
    });
  }

  private isPositionEligible(
    position: LiquidatablePosition,
    now: number,
    skippedCooldownBorrowers: Set<PositionKey>,
    skippedBackoffBorrowers: Set<PositionKey>,
  ): boolean {
    const positionKey = this.getPositionKey(position);

    if (this.isInCooldown(positionKey, now)) {
      if (!skippedCooldownBorrowers.has(positionKey)) {
        this.stats.skippedDueToCooldown += 1;
        skippedCooldownBorrowers.add(positionKey);
      }
      return false;
    }

    if (this.isInRetryBackoff(positionKey, now)) {
      if (!skippedBackoffBorrowers.has(positionKey)) {
        this.stats.skippedDueToBackoff += 1;
        skippedBackoffBorrowers.add(positionKey);
      }
      return false;
    }

    return true;
  }

  private getPositionKey(position: LiquidatablePosition): PositionKey {
    return `${position.borrower.toLowerCase()}|${position.repayToken.toLowerCase()}|${position.seizeToken.toLowerCase()}`;
  }

  private isInCooldown(positionKey: PositionKey, now: number): boolean {
    const cooldownUntil = this.cooldowns.get(positionKey);
    if (!cooldownUntil) return false;
    if (cooldownUntil <= now) {
      this.cooldowns.delete(positionKey);
      return false;
    }
    return true;
  }

  private isInRetryBackoff(positionKey: PositionKey, now: number): boolean {
    const retryState = this.retryStates.get(positionKey);
    if (!retryState) return false;
    if (retryState.nextRetryAt <= now) {
      this.retryStates.delete(positionKey);
      return false;
    }
    return true;
  }

  private cleanupCooldowns(now: number): void {
    this.cooldowns.forEach((expiry, positionKey) => {
      if (expiry <= now) {
        this.cooldowns.delete(positionKey);
      }
    });
  }

  private cleanupRetries(now: number): void {
    this.retryStates.forEach((state, positionKey) => {
      if (state.nextRetryAt <= now) {
        this.retryStates.delete(positionKey);
      }
    });
  }

  private getExecutionConfig(): ExecutionConfig {
    return this.config.execution || {
      intervalMs: 30000,
      maxRetries: 3,
      baseRetryDelayMs: 60000,
      maxRetryDelayMs: 600000,
      successCooldownMs: 300000,
    };
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;

    this.shuttingDown = true;
    this.running = false;
    this.stats.isRunning = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.tickInProgress) {
      logger.info('Execution service shutdown: waiting for in-flight tick to complete');
    }

    while (this.tickInProgress) {
      // Short sleep to avoid busy waiting while an execution tick finishes.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Align shutdown behavior with stop: clear transient execution state.
    this.retryStates.clear();
    this.cooldowns.clear();
    this.stats.positionsInRetry = 0;
    this.stats.positionsInCooldown = 0;

    logger.info('Execution service shutdown complete');
  }
}

export default ExecutionService;

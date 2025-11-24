import fs from 'fs/promises';
import { BotConfig, DailyStats, RiskCheckResult, RiskCheckType } from '../../types';
import { logger } from '../../utils/logger';

class DailyLossTracker {
  private dailyStats: DailyStats = {
    date: '',
    totalAttempts: 0,
    successCount: 0,
    failureCount: 0,
    totalProfitUsd: 0,
    totalLossUsd: 0,
    netProfitUsd: 0,
  };

  private readonly statsFilePath = './daily_stats.json';

  constructor(private readonly config: BotConfig) {}

  async initialize(): Promise<void> {
    await this.loadStats();
  }

  private getTodayDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private async loadStats(): Promise<void> {
    try {
      const data = await fs.readFile(this.statsFilePath, 'utf-8');
      const parsed: DailyStats = JSON.parse(data);
      if (parsed.date !== this.getTodayDateString()) {
        logger.info('Resetting daily stats for new day');
        this.resetStats();
      } else {
        this.dailyStats = parsed;
      }
    } catch (error) {
      this.resetStats();
    }
  }

  private async saveStats(): Promise<void> {
    await fs.writeFile(this.statsFilePath, JSON.stringify(this.dailyStats, null, 2), 'utf-8');
  }

  recordAttempt(success: boolean, profitUsd: number): void {
    this.dailyStats.totalAttempts += 1;
    if (success) {
      this.dailyStats.successCount += 1;
    } else {
      this.dailyStats.failureCount += 1;
    }

    if (profitUsd < 0) {
      this.dailyStats.totalLossUsd += Math.abs(profitUsd);
    } else {
      this.dailyStats.totalProfitUsd += profitUsd;
    }

    this.dailyStats.netProfitUsd = this.dailyStats.totalProfitUsd - this.dailyStats.totalLossUsd;
    void this.saveStats();
    logger.debug('Updated daily stats', { stats: this.dailyStats });
  }

  checkDailyLossLimit(): RiskCheckResult {
    const limit = this.config.maxDailyLossUsd ?? 0;
    if (limit <= 0) {
      return { passed: true, checkType: RiskCheckType.DAILY_LOSS_LIMIT };
    }

    if (this.dailyStats.totalLossUsd > limit) {
      logger.warn('Daily loss limit exceeded', {
        totalLossUsd: this.dailyStats.totalLossUsd,
        netProfitUsd: this.dailyStats.netProfitUsd,
        limit
      });
      return {
        passed: false,
        checkType: RiskCheckType.DAILY_LOSS_LIMIT,
        reason: 'Daily loss limit exceeded',
        details: {
          totalLossUsd: this.dailyStats.totalLossUsd,
          netProfitUsd: this.dailyStats.netProfitUsd,
          limit
        },
      };
    }

    return { passed: true, checkType: RiskCheckType.DAILY_LOSS_LIMIT };
  }

  getStats(): DailyStats {
    return this.dailyStats;
  }

  resetStats(): void {
    this.dailyStats = {
      date: this.getTodayDateString(),
      totalAttempts: 0,
      successCount: 0,
      failureCount: 0,
      totalProfitUsd: 0,
      totalLossUsd: 0,
      netProfitUsd: 0,
    };
    void this.saveStats();
  }
}

export default DailyLossTracker;

/**
 * Periodic Healthcare Monitoring
 * Автоматически проверяет здоровье позиций каждые N минут
 */

import { JsonRpcProvider } from 'ethers';
import { loadConfig } from '../config';
import VenusContracts from '../contracts/VenusContracts';
import HealthFactorCalculator from '../services/monitoring/HealthFactorCalculator';
import { logger } from '../utils/logger';
import * as fs from 'fs';

interface PositionSnapshot {
  address: string;
  healthFactor: number;
  totalBorrowUsd: number;
  totalCollateralUsd: number;
  riskLevel: string;
  timestamp: number;
}

interface MonitoringHistory {
  snapshots: PositionSnapshot[];
  alerts: Array<{
    timestamp: number;
    address: string;
    message: string;
    healthFactor: number;
  }>;
}

class PeriodicHealthMonitor {
  private config: any;
  private provider: JsonRpcProvider;
  private venusContracts: VenusContracts;
  private healthCalculator: HealthFactorCalculator;
  private monitoringHistory: MonitoringHistory = { snapshots: [], alerts: [] };
  private knownBorrowers: Set<string> = new Set();
  private intervalId?: NodeJS.Timeout;

  constructor() {
    this.config = loadConfig();
    this.provider = new JsonRpcProvider(this.config.rpcUrl);
    this.venusContracts = new VenusContracts(this.provider, this.config.venus.comptroller);
    this.healthCalculator = new HealthFactorCalculator(this.venusContracts);
  }

  async initialize(): Promise<void> {
    await this.venusContracts.initialize();
    logger.info('Periodic health monitor initialized');

    // Загружаем известных заемщиков из предыдущего snapshot
    try {
      if (fs.existsSync('./healthcare_snapshot.json')) {
        const snapshot = JSON.parse(fs.readFileSync('./healthcare_snapshot.json', 'utf-8'));
        if (snapshot.borrowers) {
          snapshot.borrowers.forEach((b: any) => this.knownBorrowers.add(b.address));
          logger.info(`Loaded ${this.knownBorrowers.size} known borrowers from snapshot`);
        }
      }
    } catch (e) {
      logger.warn('Failed to load previous snapshot', { error: e });
    }

    // Загружаем историю мониторинга
    try {
      if (fs.existsSync('./monitoring_history.json')) {
        this.monitoringHistory = JSON.parse(fs.readFileSync('./monitoring_history.json', 'utf-8'));
        logger.info(`Loaded monitoring history with ${this.monitoringHistory.snapshots.length} snapshots`);
      }
    } catch (e) {
      logger.warn('Failed to load monitoring history', { error: e });
    }
  }

  getRiskLevel(healthFactor: number): string {
    if (healthFactor < 1.0) return 'CRITICAL';
    if (healthFactor < 1.1) return 'CRITICAL';
    if (healthFactor < 1.3) return 'HIGH';
    if (healthFactor < 1.5) return 'MEDIUM';
    if (healthFactor < 2.0) return 'LOW';
    return 'SAFE';
  }

  async checkPosition(address: string): Promise<PositionSnapshot | null> {
    try {
      const position = await this.healthCalculator.getPositionDetails(address);

      if (!position || position.debtValueUsd === 0) {
        return null;
      }

      const healthFactor = position.healthFactor;
      const riskLevel = this.getRiskLevel(healthFactor);

      return {
        address,
        healthFactor: isFinite(healthFactor) ? Math.round(healthFactor * 1000) / 1000 : Infinity,
        totalBorrowUsd: Math.round(position.debtValueUsd * 100) / 100,
        totalCollateralUsd: Math.round(position.collateralValueUsd * 100) / 100,
        riskLevel,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.warn(`Failed to check position ${address}`, { error });
      return null;
    }
  }

  async checkAllPositions(): Promise<void> {
    console.log('\n' + '='.repeat(80));
    console.log(`🔍 Healthcare Check - ${new Date().toLocaleString()}`);
    console.log('='.repeat(80));

    const snapshots: PositionSnapshot[] = [];

    for (const address of this.knownBorrowers) {
      const snapshot = await this.checkPosition(address);
      if (snapshot) {
        snapshots.push(snapshot);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Сортируем по health factor (самые рискованные первыми)
    snapshots.sort((a, b) => {
      if (a.healthFactor === Infinity && b.healthFactor === Infinity) return 0;
      if (a.healthFactor === Infinity) return 1;
      if (b.healthFactor === Infinity) return -1;
      return a.healthFactor - b.healthFactor;
    });

    // Добавляем в историю
    this.monitoringHistory.snapshots.push(...snapshots);

    // Проверяем алерты
    for (const snapshot of snapshots) {
      if (snapshot.riskLevel === 'CRITICAL' || snapshot.riskLevel === 'HIGH') {
        const alert = {
          timestamp: Date.now(),
          address: snapshot.address,
          message: `⚠️  Position at risk! HF: ${snapshot.healthFactor}`,
          healthFactor: snapshot.healthFactor,
        };

        this.monitoringHistory.alerts.push(alert);
        console.log(`\n🚨 ALERT: ${alert.message} - ${snapshot.address}`);
        logger.warn('Position at risk detected', alert);
      }
    }

    // Выводим summary
    const riskDist = {
      critical: snapshots.filter(s => s.riskLevel === 'CRITICAL').length,
      high: snapshots.filter(s => s.riskLevel === 'HIGH').length,
      medium: snapshots.filter(s => s.riskLevel === 'MEDIUM').length,
      low: snapshots.filter(s => s.riskLevel === 'LOW').length,
      safe: snapshots.filter(s => s.riskLevel === 'SAFE').length,
    };

    const totalBorrowed = snapshots.reduce((sum, s) => sum + s.totalBorrowUsd, 0);
    const totalCollateral = snapshots.reduce((sum, s) => sum + s.totalCollateralUsd, 0);

    console.log(`\n📊 Status: ${snapshots.length} positions monitored`);
    console.log(`💰 Total Borrowed: $${totalBorrowed.toLocaleString()}`);
    console.log(`🏦 Total Collateral: $${totalCollateral.toLocaleString()}`);
    console.log(`\n🎯 Risk Distribution:`);
    console.log(`   🔴 CRITICAL: ${riskDist.critical}`);
    console.log(`   🟠 HIGH:     ${riskDist.high}`);
    console.log(`   🟡 MEDIUM:   ${riskDist.medium}`);
    console.log(`   🟢 LOW:      ${riskDist.low}`);
    console.log(`   ⚪ SAFE:     ${riskDist.safe}`);

    // Показываем топ-5 самых рискованных
    const risky = snapshots.filter(s => s.healthFactor !== Infinity).slice(0, 5);
    if (risky.length > 0) {
      console.log(`\n⚠️  Top 5 Riskiest Positions:`);
      risky.forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.address} - HF: ${s.healthFactor} ($${s.totalBorrowUsd.toLocaleString()} borrowed)`);
      });
    }

    console.log('='.repeat(80) + '\n');

    // Сохраняем историю
    this.saveHistory();
  }

  saveHistory(): void {
    // Храним только последние 1000 snapshots для экономии места
    if (this.monitoringHistory.snapshots.length > 1000) {
      this.monitoringHistory.snapshots = this.monitoringHistory.snapshots.slice(-1000);
    }

    // Храним только последние 100 алертов
    if (this.monitoringHistory.alerts.length > 100) {
      this.monitoringHistory.alerts = this.monitoringHistory.alerts.slice(-100);
    }

    fs.writeFileSync('./monitoring_history.json', JSON.stringify(this.monitoringHistory, null, 2));
  }

  start(intervalMinutes: number = 5): void {
    console.log(`\n🏥 Starting periodic healthcare monitoring (every ${intervalMinutes} minutes)...\n`);

    // Первая проверка сразу
    this.checkAllPositions().catch(error => {
      logger.error('Failed to check positions', { error });
    });

    // Периодические проверки
    this.intervalId = setInterval(async () => {
      try {
        await this.checkAllPositions();
      } catch (error) {
        logger.error('Failed to check positions', { error });
      }
    }, intervalMinutes * 60 * 1000);

    logger.info(`Periodic monitoring started with ${intervalMinutes}min interval`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Periodic monitoring stopped');
    }
  }
}

// Main execution
async function main() {
  const monitor = new PeriodicHealthMonitor();
  await monitor.initialize();

  // Запускаем мониторинг каждые 5 минут (можно изменить)
  const intervalMinutes = parseInt(process.env.MONITOR_INTERVAL_MINUTES || '5');
  monitor.start(intervalMinutes);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down healthcare monitor...');
    monitor.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\nShutting down healthcare monitor...');
    monitor.stop();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Periodic healthcare monitor failed', { error });
    process.exit(1);
  });
}

export { PeriodicHealthMonitor };

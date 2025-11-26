/**
 * Healthcare Monitoring Script
 * Отслеживает здоровье позиций всех заемщиков Venus Protocol
 */

import { JsonRpcProvider } from 'ethers';
import { loadConfig } from '../config';
import VenusContracts from '../contracts/VenusContracts';
import HealthFactorCalculator from '../services/monitoring/HealthFactorCalculator';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface BorrowerHealthReport {
  address: string;
  healthFactor: number;
  totalBorrowUsd: number;
  totalCollateralUsd: number;
  distanceToLiquidation: number; // в процентах, сколько может упасть collateral до ликвидации
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  borrowTokens: string[];
  collateralTokens: string[];
  lastChecked: number;
}

interface HealthcareSnapshot {
  timestamp: number;
  totalBorrowers: number;
  riskDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    safe: number;
  };
  totalBorrowedUsd: number;
  totalCollateralUsd: number;
  averageHealthFactor: number;
  borrowers: BorrowerHealthReport[];
}

class HealthcareMonitor {
  private provider: JsonRpcProvider;
  private venusContracts: VenusContracts;
  private healthCalculator: HealthFactorCalculator;
  private config: any;

  constructor() {
    this.config = loadConfig();
    this.provider = new JsonRpcProvider(this.config.rpcUrl);
    this.venusContracts = new VenusContracts(
      this.provider,
      this.config.venus.comptroller
    );
    this.healthCalculator = new HealthFactorCalculator(this.venusContracts);
  }

  async initialize(): Promise<void> {
    await this.venusContracts.initialize();
    logger.info('Healthcare monitor initialized');
  }

  /**
   * Определяет уровень риска на основе health factor
   */
  private getRiskLevel(healthFactor: number): BorrowerHealthReport['riskLevel'] {
    if (healthFactor < 1.0) return 'CRITICAL'; // Already liquidatable
    if (healthFactor < 1.1) return 'CRITICAL'; // Very close to liquidation
    if (healthFactor < 1.3) return 'HIGH';     // High risk
    if (healthFactor < 1.5) return 'MEDIUM';   // Medium risk
    if (healthFactor < 2.0) return 'LOW';      // Low risk
    return 'SAFE';                              // Safe
  }

  /**
   * Вычисляет расстояние до ликвидации в процентах
   * Показывает на сколько процентов может упасть стоимость коллатерала до ликвидации
   */
  private calculateDistanceToLiquidation(healthFactor: number): number {
    if (healthFactor <= 1.0) return 0; // Already liquidatable

    // Health Factor = Collateral Value / Borrow Value
    // Если HF = 1.5, то collateral может упасть на (1 - 1/1.5) = 33.3%
    // Если HF = 2.0, то collateral может упасть на (1 - 1/2.0) = 50%
    const distancePercent = (1 - 1 / healthFactor) * 100;
    return Math.max(0, distancePercent);
  }

  /**
   * Получает детальную информацию о здоровье позиции заемщика
   */
  async getBorrowerHealth(borrowerAddress: string): Promise<BorrowerHealthReport | null> {
    try {
      const position = await this.healthCalculator.getPositionDetails(borrowerAddress);

      if (!position || position.debtValueUsd === 0) {
        return null; // Нет активной позиции
      }

      const healthFactor = position.healthFactor;
      const riskLevel = this.getRiskLevel(healthFactor);
      const distanceToLiquidation = this.calculateDistanceToLiquidation(healthFactor);

      return {
        address: borrowerAddress,
        healthFactor: Math.round(healthFactor * 1000) / 1000, // 3 decimal places
        totalBorrowUsd: Math.round(position.debtValueUsd * 100) / 100,
        totalCollateralUsd: Math.round(position.collateralValueUsd * 100) / 100,
        distanceToLiquidation: Math.round(distanceToLiquidation * 100) / 100,
        riskLevel,
        borrowTokens: position.borrowTokens,
        collateralTokens: position.collateralTokens,
        lastChecked: Date.now(),
      };
    } catch (error) {
      logger.warn('Failed to get borrower health', { borrowerAddress, error });
      return null;
    }
  }

  /**
   * Получает список всех заемщиков из логов бота
   */
  private async getAllBorrowersFromCache(): Promise<string[]> {
    // Получаем всех заемщиков, сканируя все рынки Venus
    const allVTokens = await this.venusContracts.getAllVTokens();
    const borrowersSet = new Set<string>();

    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(1, currentBlock - 57600); // Last ~2 days

    logger.info('Scanning for borrowers across all Venus markets', {
      totalMarkets: allVTokens.length,
      fromBlock,
      currentBlock,
      blockRange: currentBlock - fromBlock
    });

    for (const vTokenAddress of allVTokens) {
      try {
        const vToken = this.venusContracts.getVToken(vTokenAddress);

        // Get Borrow events
        const borrowFilter = vToken.filters.Borrow();
        const borrowEvents = await vToken.queryFilter(borrowFilter, fromBlock, currentBlock);

        for (const event of borrowEvents) {
          if ('args' in event) {
            const borrower = event.args?.borrower;
            if (borrower) {
              borrowersSet.add(borrower);
            }
          }
        }

        // Get RepayBorrow events
        const repayFilter = vToken.filters.RepayBorrow();
        const repayEvents = await vToken.queryFilter(repayFilter, fromBlock, currentBlock);

        for (const event of repayEvents) {
          if ('args' in event) {
            const borrower = event.args?.borrower;
            if (borrower) {
              borrowersSet.add(borrower);
            }
          }
        }

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.warn('Failed to scan market for borrowers', { vTokenAddress, error });
      }
    }

    return Array.from(borrowersSet);
  }

  /**
   * Создает полный snapshot здоровья всех заемщиков
   */
  async createHealthSnapshot(): Promise<HealthcareSnapshot> {
    logger.info('Creating healthcare snapshot...');

    const borrowers = await this.getAllBorrowersFromCache();
    logger.info(`Found ${borrowers.length} unique borrowers to analyze`);

    const healthReports: BorrowerHealthReport[] = [];
    let processedCount = 0;

    for (const borrowerAddress of borrowers) {
      const health = await this.getBorrowerHealth(borrowerAddress);
      if (health) {
        healthReports.push(health);
      }

      processedCount++;
      if (processedCount % 10 === 0) {
        logger.info(`Progress: ${processedCount}/${borrowers.length} borrowers analyzed`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Сортируем по health factor (самые рискованные сначала)
    healthReports.sort((a, b) => a.healthFactor - b.healthFactor);

    // Вычисляем статистику
    const riskDistribution = {
      critical: healthReports.filter(b => b.riskLevel === 'CRITICAL').length,
      high: healthReports.filter(b => b.riskLevel === 'HIGH').length,
      medium: healthReports.filter(b => b.riskLevel === 'MEDIUM').length,
      low: healthReports.filter(b => b.riskLevel === 'LOW').length,
      safe: healthReports.filter(b => b.riskLevel === 'SAFE').length,
    };

    const totalBorrowedUsd = healthReports.reduce((sum, b) => sum + b.totalBorrowUsd, 0);
    const totalCollateralUsd = healthReports.reduce((sum, b) => sum + b.totalCollateralUsd, 0);
    const averageHealthFactor = healthReports.length > 0
      ? healthReports.reduce((sum, b) => sum + b.healthFactor, 0) / healthReports.length
      : 0;

    return {
      timestamp: Date.now(),
      totalBorrowers: healthReports.length,
      riskDistribution,
      totalBorrowedUsd: Math.round(totalBorrowedUsd * 100) / 100,
      totalCollateralUsd: Math.round(totalCollateralUsd * 100) / 100,
      averageHealthFactor: Math.round(averageHealthFactor * 1000) / 1000,
      borrowers: healthReports,
    };
  }

  /**
   * Выводит отчет в консоль
   */
  printReport(snapshot: HealthcareSnapshot): void {
    console.log('\n' + '='.repeat(100));
    console.log('🏥 VENUS PROTOCOL HEALTHCARE REPORT');
    console.log('='.repeat(100));
    console.log(`📅 Timestamp: ${new Date(snapshot.timestamp).toLocaleString()}`);
    console.log(`👥 Total Borrowers: ${snapshot.totalBorrowers}`);
    console.log(`💰 Total Borrowed: $${snapshot.totalBorrowedUsd.toLocaleString()}`);
    console.log(`🏦 Total Collateral: $${snapshot.totalCollateralUsd.toLocaleString()}`);
    console.log(`📊 Average Health Factor: ${snapshot.averageHealthFactor}`);
    console.log('\n📈 RISK DISTRIBUTION:');
    console.log(`  🔴 CRITICAL: ${snapshot.riskDistribution.critical} (HF < 1.1)`);
    console.log(`  🟠 HIGH:     ${snapshot.riskDistribution.high} (HF < 1.3)`);
    console.log(`  🟡 MEDIUM:   ${snapshot.riskDistribution.medium} (HF < 1.5)`);
    console.log(`  🟢 LOW:      ${snapshot.riskDistribution.low} (HF < 2.0)`);
    console.log(`  ⚪ SAFE:     ${snapshot.riskDistribution.safe} (HF >= 2.0)`);

    console.log('\n' + '='.repeat(100));
    console.log('📋 BORROWER DETAILS (sorted by risk):');
    console.log('='.repeat(100));
    console.log(
      'Risk'.padEnd(10) +
      'Address'.padEnd(44) +
      'Health'.padEnd(8) +
      'Debt (USD)'.padEnd(15) +
      'Collateral (USD)'.padEnd(18) +
      'Distance'
    );
    console.log('-'.repeat(100));

    for (const borrower of snapshot.borrowers) {
      const riskEmoji = {
        'CRITICAL': '🔴',
        'HIGH': '🟠',
        'MEDIUM': '🟡',
        'LOW': '🟢',
        'SAFE': '⚪'
      }[borrower.riskLevel];

      const riskText = `${riskEmoji} ${borrower.riskLevel}`;
      const address = borrower.address.substring(0, 42);
      const health = borrower.healthFactor.toFixed(3);
      const debt = `$${borrower.totalBorrowUsd.toLocaleString()}`;
      const collateral = `$${borrower.totalCollateralUsd.toLocaleString()}`;
      const distance = borrower.healthFactor >= 1.0
        ? `${borrower.distanceToLiquidation.toFixed(1)}%`
        : 'LIQUIDATABLE';

      console.log(
        riskText.padEnd(10) +
        address.padEnd(44) +
        health.padEnd(8) +
        debt.padEnd(15) +
        collateral.padEnd(18) +
        distance
      );
    }

    console.log('='.repeat(100) + '\n');
  }

  /**
   * Сохраняет snapshot в файл
   */
  saveSnapshot(snapshot: HealthcareSnapshot, filename: string = 'healthcare_snapshot.json'): void {
    const filepath = path.join(process.cwd(), filename);
    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
    logger.info(`Healthcare snapshot saved to ${filepath}`);
  }

  /**
   * Добавляет snapshot в историю (для трекинга изменений со временем)
   */
  appendToHistory(snapshot: HealthcareSnapshot, historyFile: string = 'healthcare_history.jsonl'): void {
    const filepath = path.join(process.cwd(), historyFile);
    const line = JSON.stringify(snapshot) + '\n';
    fs.appendFileSync(filepath, line);
    logger.info(`Snapshot appended to history: ${filepath}`);
  }
}

// Main execution
async function main() {
  const monitor = new HealthcareMonitor();
  await monitor.initialize();

  // Создаем snapshot
  const snapshot = await monitor.createHealthSnapshot();

  // Выводим отчет
  monitor.printReport(snapshot);

  // Сохраняем snapshot
  monitor.saveSnapshot(snapshot);

  // Добавляем в историю
  monitor.appendToHistory(snapshot);

  logger.info('Healthcare monitoring completed');
  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Healthcare monitoring failed', { error });
    process.exit(1);
  });
}

export { HealthcareMonitor, BorrowerHealthReport, HealthcareSnapshot };

/**
 * Quick Healthcare Check
 * Быстрая проверка здоровья известных заемщиков
 */

import { JsonRpcProvider } from 'ethers';
import { loadConfig } from '../config';
import VenusContracts from '../contracts/VenusContracts';
import HealthFactorCalculator from '../services/monitoring/HealthFactorCalculator';
import { logger } from '../utils/logger';
import * as fs from 'fs';

interface BorrowerHealth {
  address: string;
  healthFactor: number;
  totalBorrowUsd: number;
  totalCollateralUsd: number;
  distanceToLiquidation: number;
  riskLevel: string;
}

// Список заемщиков из последнего сканирования бота
// Эти адреса можно обновлять вручную или получать из логов бота
const KNOWN_BORROWERS: string[] = [
  // Добавьте адреса заемщиков сюда, или мы получим их программно
];

async function quickHealthcheck() {
  const config = loadConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  const venusContracts = new VenusContracts(provider, config.venus.comptroller);
  const healthCalculator = new HealthFactorCalculator(venusContracts);

  await venusContracts.initialize();
  logger.info('Quick healthcheck initialized');

  // Получаем список заемщиков из логов основного бота, если файл существует
  let borrowers: string[] = KNOWN_BORROWERS;

  // Пытаемся загрузить borrowers из daily_stats.json или других источников
  try {
    if (fs.existsSync('./daily_stats.json')) {
      const stats = JSON.parse(fs.readFileSync('./daily_stats.json', 'utf-8'));
      if (stats.knownBorrowers) {
        borrowers = stats.knownBorrowers;
      }
    }
  } catch (e) {
    // Ignore
  }

  // Если нет известных заемщиков, сканируем последние блоки
  if (borrowers.length === 0) {
    logger.info('No known borrowers, scanning recent blocks...');
    const currentBlock = await provider.getBlockNumber();

    // Сканируем последние 30000 блоков чанками по 5000, чтобы не превысить лимит NodeReal
    const blockRange = 30000;
    const chunkSize = 5000;
    const allVTokens = await venusContracts.getAllVTokens();
    const borrowersSet = new Set<string>();

    // Используем только топ-10 рынков Venus для быстрого сканирования
    const topMarkets = allVTokens.slice(0, 10);

    for (let i = 0; i < topMarkets.length; i++) {
      const vTokenAddress = topMarkets[i];
      try {
        const vToken = venusContracts.getVToken(vTokenAddress);

        // Разбиваем на чанки
        for (let offset = 0; offset < blockRange; offset += chunkSize) {
          const fromBlock = Math.max(1, currentBlock - blockRange + offset);
          const toBlock = Math.min(currentBlock, fromBlock + chunkSize);

          const borrowFilter = vToken.filters.Borrow();
          const events = await vToken.queryFilter(borrowFilter, fromBlock, toBlock);

          for (const event of events) {
            if ('args' in event && event.args?.borrower) {
              borrowersSet.add(event.args.borrower);
            }
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }

        logger.info(`Scanned market ${i + 1}/${topMarkets.length}, found ${borrowersSet.size} unique borrowers so far`);
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        logger.warn(`Failed to scan ${vTokenAddress}:`, error);
      }
    }

    borrowers = Array.from(borrowersSet);
    logger.info(`Found ${borrowers.length} total unique borrowers`);
  }

  if (borrowers.length === 0) {
    console.log('\n❌ No borrowers found. Run the main bot first to discover positions.\n');
    process.exit(0);
  }

  const healthReports: BorrowerHealth[] = [];

  console.log(`\n🔍 Analyzing ${borrowers.length} borrower positions...\n`);

  for (let i = 0; i < borrowers.length; i++) {
    const borrower = borrowers[i];
    try {
      const position = await healthCalculator.getPositionDetails(borrower);

      if (position && position.debtValueUsd > 0) {
        const healthFactor = position.healthFactor;
        const distanceToLiquidation = healthFactor > 1.0
          ? ((1 - 1 / healthFactor) * 100)
          : 0;

        let riskLevel = 'SAFE';
        if (healthFactor < 1.0) riskLevel = 'CRITICAL';
        else if (healthFactor < 1.1) riskLevel = 'CRITICAL';
        else if (healthFactor < 1.3) riskLevel = 'HIGH';
        else if (healthFactor < 1.5) riskLevel = 'MEDIUM';
        else if (healthFactor < 2.0) riskLevel = 'LOW';

        healthReports.push({
          address: borrower,
          healthFactor: Math.round(healthFactor * 1000) / 1000,
          totalBorrowUsd: Math.round(position.debtValueUsd * 100) / 100,
          totalCollateralUsd: Math.round(position.collateralValueUsd * 100) / 100,
          distanceToLiquidation: Math.round(distanceToLiquidation * 100) / 100,
          riskLevel,
        });
      }

      if ((i + 1) % 5 === 0) {
        console.log(`  Progress: ${i + 1}/${borrowers.length}`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logger.warn(`Failed to get health for ${borrower}`, { error });
    }
  }

  // Сортируем по health factor
  healthReports.sort((a, b) => a.healthFactor - b.healthFactor);

  // Подсчитываем статистику
  const riskDist = {
    critical: healthReports.filter(b => b.riskLevel === 'CRITICAL').length,
    high: healthReports.filter(b => b.riskLevel === 'HIGH').length,
    medium: healthReports.filter(b => b.riskLevel === 'MEDIUM').length,
    low: healthReports.filter(b => b.riskLevel === 'LOW').length,
    safe: healthReports.filter(b => b.riskLevel === 'SAFE').length,
  };

  const totalBorrowed = healthReports.reduce((sum, b) => sum + b.totalBorrowUsd, 0);
  const totalCollateral = healthReports.reduce((sum, b) => sum + b.totalCollateralUsd, 0);
  const avgHF = healthReports.length > 0
    ? healthReports.reduce((sum, b) => sum + b.healthFactor, 0) / healthReports.length
    : 0;

  // Выводим отчет
  console.log('\n' + '='.repeat(100));
  console.log('🏥 VENUS PROTOCOL HEALTHCARE REPORT');
  console.log('='.repeat(100));
  console.log(`📅 Timestamp: ${new Date().toLocaleString()}`);
  console.log(`👥 Total Borrowers Analyzed: ${healthReports.length}`);
  console.log(`💰 Total Borrowed: $${totalBorrowed.toLocaleString()}`);
  console.log(`🏦 Total Collateral: $${totalCollateral.toLocaleString()}`);
  console.log(`📊 Average Health Factor: ${avgHF.toFixed(3)}`);
  console.log('\n📈 RISK DISTRIBUTION:');
  console.log(`  🔴 CRITICAL: ${riskDist.critical} positions (HF < 1.1)`);
  console.log(`  🟠 HIGH:     ${riskDist.high} positions (HF < 1.3)`);
  console.log(`  🟡 MEDIUM:   ${riskDist.medium} positions (HF < 1.5)`);
  console.log(`  🟢 LOW:      ${riskDist.low} positions (HF < 2.0)`);
  console.log(`  ⚪ SAFE:     ${riskDist.safe} positions (HF >= 2.0)`);

  console.log('\n' + '='.repeat(100));
  console.log('📋 BORROWER DETAILS (sorted by risk):');
  console.log('='.repeat(100));
  console.log(
    'Risk'.padEnd(12) +
    'Address'.padEnd(44) +
    'HF'.padEnd(8) +
    'Debt (USD)'.padEnd(15) +
    'Collateral (USD)'.padEnd(18) +
    'To Liquidation'
  );
  console.log('-'.repeat(100));

  for (const b of healthReports) {
    const emoji = {
      'CRITICAL': '🔴',
      'HIGH': '🟠',
      'MEDIUM': '🟡',
      'LOW': '🟢',
      'SAFE': '⚪'
    }[b.riskLevel] || '⚪';

    const riskText = `${emoji} ${b.riskLevel}`;
    const distance = b.healthFactor >= 1.0 ? `${b.distanceToLiquidation.toFixed(1)}%` : 'LIQUIDATABLE!';

    console.log(
      riskText.padEnd(12) +
      b.address.padEnd(44) +
      b.healthFactor.toFixed(3).padEnd(8) +
      `$${b.totalBorrowUsd.toLocaleString()}`.padEnd(15) +
      `$${b.totalCollateralUsd.toLocaleString()}`.padEnd(18) +
      distance
    );
  }

  console.log('='.repeat(100) + '\n');

  // Сохраняем snapshot
  const snapshot = {
    timestamp: Date.now(),
    totalBorrowers: healthReports.length,
    riskDistribution: riskDist,
    totalBorrowedUsd: totalBorrowed,
    totalCollateralUsd: totalCollateral,
    averageHealthFactor: avgHF,
    borrowers: healthReports,
  };

  fs.writeFileSync('healthcare_snapshot.json', JSON.stringify(snapshot, null, 2));
  logger.info('Snapshot saved to healthcare_snapshot.json');

  process.exit(0);
}

quickHealthcheck().catch((error) => {
  logger.error('Quick healthcheck failed', { error });
  process.exit(1);
});

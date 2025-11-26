/**
 * Small Positions Monitor
 * Мониторинг ТОЛЬКО мелких позиций (<$1K) для ликвидаторов с малым капиталом
 */

import { JsonRpcProvider } from 'ethers';
import { loadConfig } from '../config';
import VenusContracts from '../contracts/VenusContracts';
import HealthFactorCalculator from '../services/monitoring/HealthFactorCalculator';
import { logger } from '../utils/logger';
import * as fs from 'fs';

interface SmallPosition {
  address: string;
  healthFactor: number;
  totalBorrowUsd: number;
  totalCollateralUsd: number;
  distanceToLiquidation: number;
  riskLevel: string;
  priority: number; // 1 = highest priority
}

async function monitorSmallPositions() {
  const config = loadConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  const venusContracts = new VenusContracts(provider, config.venus.comptroller);
  const healthCalculator = new HealthFactorCalculator(venusContracts);

  await venusContracts.initialize();

  // Загружаем все позиции из полного snapshot
  let allPositions: any[] = [];
  try {
    if (fs.existsSync('./full_protocol_snapshot.json')) {
      const snapshot = JSON.parse(fs.readFileSync('./full_protocol_snapshot.json', 'utf-8'));
      allPositions = snapshot.borrowers || [];
      logger.info(`Loaded ${allPositions.length} positions from snapshot`);
    }
  } catch (e) {
    logger.error('Failed to load snapshot', { error: e });
    process.exit(1);
  }

  // Фильтруем только МЕЛКИЕ позиции (<$1000)
  const smallPositionAddresses = allPositions
    .filter(p => p.totalBorrowUsd < 1000)
    .map(p => p.address);

  console.log(`\n🔍 Мониторинг ${smallPositionAddresses.length} мелких позиций (<$1K)...`);
  console.log(`💰 Ваш капитал: ~$100`);
  console.log(`✅ Эти позиции доступны для ликвидации с вашим капиталом!\n`);

  const positions: SmallPosition[] = [];

  for (const address of smallPositionAddresses) {
    try {
      const position = await healthCalculator.getPositionDetails(address);

      if (position && position.debtValueUsd > 0 && position.debtValueUsd < 1000) {
        const healthFactor = position.healthFactor;
        const distanceToLiquidation = healthFactor > 1.0
          ? ((1 - 1 / healthFactor) * 100)
          : 0;

        let riskLevel = 'SAFE';
        let priority = 5; // Default low priority

        if (healthFactor < 1.0) {
          riskLevel = 'LIQUIDATABLE';
          priority = 1;
        } else if (healthFactor < 1.1) {
          riskLevel = 'CRITICAL';
          priority = 1;
        } else if (healthFactor < 1.3) {
          riskLevel = 'HIGH';
          priority = 2;
        } else if (healthFactor < 1.5) {
          riskLevel = 'MEDIUM';
          priority = 3;
        } else if (healthFactor < 2.0) {
          riskLevel = 'LOW';
          priority = 4;
        }

        positions.push({
          address,
          healthFactor: isFinite(healthFactor) ? Math.round(healthFactor * 1000) / 1000 : Infinity,
          totalBorrowUsd: Math.round(position.debtValueUsd * 100) / 100,
          totalCollateralUsd: Math.round(position.collateralValueUsd * 100) / 100,
          distanceToLiquidation: Math.round(distanceToLiquidation * 100) / 100,
          riskLevel,
          priority,
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logger.warn(`Failed to check ${address}`, { error });
    }
  }

  // Сортируем по приоритету (самые рискованные первыми), затем по размеру долга
  positions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.healthFactor === Infinity && b.healthFactor === Infinity) {
      return b.totalBorrowUsd - a.totalBorrowUsd; // Larger debt first
    }
    if (a.healthFactor === Infinity) return 1;
    if (b.healthFactor === Infinity) return -1;
    return a.healthFactor - b.healthFactor;
  });

  // Статистика
  const riskDist = {
    liquidatable: positions.filter(p => p.riskLevel === 'LIQUIDATABLE').length,
    critical: positions.filter(p => p.riskLevel === 'CRITICAL').length,
    high: positions.filter(p => p.riskLevel === 'HIGH').length,
    medium: positions.filter(p => p.riskLevel === 'MEDIUM').length,
    low: positions.filter(p => p.riskLevel === 'LOW').length,
    safe: positions.filter(p => p.riskLevel === 'SAFE').length,
  };

  const totalBorrowed = positions.reduce((sum, p) => sum + p.totalBorrowUsd, 0);
  const totalCollateral = positions.reduce((sum, p) => sum + p.totalCollateralUsd, 0);

  // Отчет
  console.log('='.repeat(100));
  console.log('🦐 МЕЛКИЕ ПОЗИЦИИ - МОНИТОРИНГ ДЛЯ МАЛОГО КАПИТАЛА');
  console.log('='.repeat(100));
  console.log(`📅 Время: ${new Date().toLocaleString()}`);
  console.log(`👥 Всего мелких позиций: ${positions.length}`);
  console.log(`💰 Общий долг: $${totalBorrowed.toLocaleString()}`);
  console.log(`🏦 Общее обеспечение: $${totalCollateral.toLocaleString()}`);
  console.log(`💵 Средний размер долга: $${(totalBorrowed / positions.length).toFixed(2)}`);

  console.log('\n⚠️  РАСПРЕДЕЛЕНИЕ ПО РИСКАМ:');
  console.log(`  💥 LIQUIDATABLE:    ${riskDist.liquidatable} позиций (HF < 1.0) - ГОТОВЫ К ЛИКВИДАЦИИ!`);
  console.log(`  🔴 CRITICAL:        ${riskDist.critical} позиций (HF < 1.1) - Очень близко!`);
  console.log(`  🟠 HIGH:            ${riskDist.high} позиций (HF < 1.3) - Высокий риск`);
  console.log(`  🟡 MEDIUM:          ${riskDist.medium} позиций (HF < 1.5) - Средний риск`);
  console.log(`  🟢 LOW:             ${riskDist.low} позиций (HF < 2.0) - Низкий риск`);
  console.log(`  ⚪ SAFE:            ${riskDist.safe} позиций (HF >= 2.0) - Безопасно`);

  // Приоритетные позиции
  const priority = positions.filter(p => p.priority <= 2); // Critical and High risk
  if (priority.length > 0) {
    console.log('\n' + '='.repeat(100));
    console.log('🎯 ПРИОРИТЕТНЫЕ ПОЗИЦИИ (Близкие к ликвидации):');
    console.log('='.repeat(100));
    console.log('Priority  Address                                        HF      Debt      Collateral  Distance');
    console.log('-'.repeat(100));

    priority.forEach(p => {
      const emoji = p.riskLevel === 'LIQUIDATABLE' ? '💥'
        : p.riskLevel === 'CRITICAL' ? '🔴'
        : '🟠';
      const priorityText = `P${p.priority}`;
      const distance = p.healthFactor >= 1.0 ? `${p.distanceToLiquidation.toFixed(1)}%` : 'READY!';

      console.log(
        `${emoji} ${priorityText}     ${p.address}  ${p.healthFactor === Infinity ? 'Inf ' : p.healthFactor.toFixed(3)}  $${p.totalBorrowUsd.toString().padEnd(7)}  $${p.totalCollateralUsd.toFixed(0).padEnd(9)}  ${distance}`
      );
    });
  } else {
    console.log('\n✅ Нет приоритетных позиций - все мелкие позиции в безопасной зоне');
  }

  // Все мелкие позиции (топ-30)
  console.log('\n' + '='.repeat(100));
  console.log('📋 ВСЕ МЕЛКИЕ ПОЗИЦИИ (топ 30 по приоритету):');
  console.log('='.repeat(100));
  console.log('Risk      Address                                        HF      Debt      Collateral  Distance');
  console.log('-'.repeat(100));

  positions.slice(0, 30).forEach(p => {
    const emoji = {
      'LIQUIDATABLE': '💥',
      'CRITICAL': '🔴',
      'HIGH': '🟠',
      'MEDIUM': '🟡',
      'LOW': '🟢',
      'SAFE': '⚪'
    }[p.riskLevel] || '⚪';

    const riskText = `${emoji} ${p.riskLevel.padEnd(12)}`;
    const distance = p.healthFactor >= 1.0 ? `${p.distanceToLiquidation.toFixed(1)}%` : 'READY!';

    console.log(
      `${riskText}  ${p.address}  ${p.healthFactor === Infinity ? 'Inf ' : p.healthFactor.toFixed(3)}  $${p.totalBorrowUsd.toString().padEnd(7)}  $${p.totalCollateralUsd.toFixed(0).padEnd(9)}  ${distance}`
    );
  });

  console.log('='.repeat(100) + '\n');

  // Сохраняем snapshot только мелких позиций
  const smallSnapshot = {
    timestamp: Date.now(),
    capitalAvailable: 100, // User's capital
    totalPositions: positions.length,
    riskDistribution: riskDist,
    totalBorrowedUsd: totalBorrowed,
    totalCollateralUsd: totalCollateral,
    averageDebtSize: totalBorrowed / positions.length,
    positions: positions,
  };

  fs.writeFileSync('small_positions_snapshot.json', JSON.stringify(smallSnapshot, null, 2));
  logger.info('Small positions snapshot saved');

  // Обновляем healthcare snapshot для мониторинга ТОЛЬКО мелких позиций
  fs.writeFileSync('healthcare_snapshot.json', JSON.stringify({
    timestamp: Date.now(),
    totalBorrowers: positions.length,
    riskDistribution: riskDist,
    totalBorrowedUsd: totalBorrowed,
    totalCollateralUsd: totalCollateral,
    averageHealthFactor: positions.reduce((s, p) => s + (isFinite(p.healthFactor) ? p.healthFactor : 0), 0) / positions.length,
    borrowers: positions.map(p => ({
      address: p.address,
      healthFactor: isFinite(p.healthFactor) ? p.healthFactor : null,
      totalBorrowUsd: p.totalBorrowUsd,
      totalCollateralUsd: p.totalCollateralUsd,
      distanceToLiquidation: p.distanceToLiquidation,
      riskLevel: p.riskLevel,
    })),
  }, null, 2));

  logger.info('Healthcare snapshot updated with small positions only');

  console.log('\n✅ Мониторинг мелких позиций завершен!');
  console.log('📁 Результаты: small_positions_snapshot.json');
  console.log('📁 Healthcare snapshot обновлен для периодического мониторинга\n');

  // Рекомендации
  if (priority.length > 0) {
    console.log('💡 РЕКОМЕНДАЦИИ:');
    console.log(`   - Следите за ${priority.length} приоритетными позициями`);
    console.log('   - Запустите периодический мониторинг: npm run healthcare:monitor');
    console.log('   - Проверяйте каждые 5 минут на изменения\n');
  }

  process.exit(0);
}

monitorSmallPositions().catch((error) => {
  logger.error('Small positions monitor failed', { error });
  process.exit(1);
});

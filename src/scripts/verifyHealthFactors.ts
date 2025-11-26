/**
 * Verify Health Factors
 * РЕАЛЬНАЯ проверка Health Factor через RPC для всех позиций
 * Исправляет ошибку где collateralRatio путали с healthFactor
 */

import { JsonRpcProvider } from 'ethers';
import { loadConfig } from '../config';
import VenusContracts from '../contracts/VenusContracts';
import HealthFactorCalculator from '../services/monitoring/HealthFactorCalculator';
import { logger } from '../utils/logger';
import * as fs from 'fs';

interface VerifiedPosition {
  address: string;
  totalBorrowUsd: number;
  totalCollateralUsd: number;
  collateralRatio: number;
  realHealthFactor: number; // РЕАЛЬНЫЙ HF из Venus
  distanceToLiquidation: number;
  riskLevel: string;
  liquidationThreshold: number; // Эффективный liquidation threshold
}

async function verifyHealthFactors() {
  const config = loadConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  const venusContracts = new VenusContracts(provider, config.venus.comptroller);
  const healthCalculator = new HealthFactorCalculator(venusContracts);

  await venusContracts.initialize();

  console.log('\n🔍 ПРОВЕРКА РЕАЛЬНЫХ HEALTH FACTORS...\n');
  console.log('⚠️  ВАЖНО: Collateral Ratio ≠ Health Factor!');
  console.log('   Health Factor учитывает liquidation threshold каждого токена\n');

  // Загружаем "реалистичные" позиции
  let realisticPositions: any[] = [];
  try {
    const snapshot = JSON.parse(fs.readFileSync('./realistic_small_positions.json', 'utf-8'));
    realisticPositions = snapshot.positions || [];
  } catch (e) {
    logger.error('Failed to load realistic positions snapshot', { error: e });
    console.log('❌ Сначала запустите: npm run healthcare:realistic\n');
    process.exit(1);
  }

  console.log(`Проверяем ${realisticPositions.length} "реалистичных" позиций...\n`);

  const verified: VerifiedPosition[] = [];
  let errorCount = 0;

  for (let i = 0; i < realisticPositions.length; i++) {
    const pos = realisticPositions[i];

    try {
      // РЕАЛЬНАЯ проверка через RPC с ТОЧНЫМ расчетом HF
      const position = await healthCalculator.getPositionDetails(pos.address);

      if (position && position.debtValueUsd > 0) {
        // Используем ТОЧНЫЙ расчет HF вместо простого API
        const realHF = await healthCalculator.calculatePreciseHealthFactor(pos.address);
        const collateralRatio = pos.collateralRatio;

        // Вычисляем эффективный liquidation threshold
        // HF = (collateral * LT) / debt
        // LT = HF * debt / collateral = HF / collateralRatio
        const effectiveLT = isFinite(realHF) && isFinite(collateralRatio)
          ? realHF / collateralRatio
          : 0;

        let riskLevel = 'SAFE';
        if (realHF < 1.0) riskLevel = 'LIQUIDATABLE';
        else if (realHF < 1.1) riskLevel = 'CRITICAL';
        else if (realHF < 1.3) riskLevel = 'HIGH';
        else if (realHF < 1.5) riskLevel = 'MEDIUM';
        else if (realHF < 2.0) riskLevel = 'LOW';

        const distanceToLiquidation = realHF > 1.0
          ? ((1 - 1 / realHF) * 100)
          : 0;

        verified.push({
          address: pos.address,
          totalBorrowUsd: pos.totalBorrowUsd,
          totalCollateralUsd: pos.totalCollateralUsd,
          collateralRatio: collateralRatio,
          realHealthFactor: isFinite(realHF) ? Math.round(realHF * 1000) / 1000 : Infinity,
          distanceToLiquidation: Math.round(distanceToLiquidation * 100) / 100,
          riskLevel,
          liquidationThreshold: Math.round(effectiveLT * 1000) / 1000,
        });
      }

      if ((i + 1) % 10 === 0) {
        console.log(`  Проверено: ${i + 1}/${realisticPositions.length}`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      errorCount++;
      logger.warn(`Failed to verify ${pos.address}`, { error });
    }
  }

  // Сортируем по РЕАЛЬНОМУ health factor
  verified.sort((a, b) => {
    if (a.realHealthFactor === Infinity && b.realHealthFactor === Infinity) return 0;
    if (a.realHealthFactor === Infinity) return 1;
    if (b.realHealthFactor === Infinity) return -1;
    return a.realHealthFactor - b.realHealthFactor;
  });

  // Статистика
  const riskDist = {
    liquidatable: verified.filter(p => p.riskLevel === 'LIQUIDATABLE').length,
    critical: verified.filter(p => p.riskLevel === 'CRITICAL').length,
    high: verified.filter(p => p.riskLevel === 'HIGH').length,
    medium: verified.filter(p => p.riskLevel === 'MEDIUM').length,
    low: verified.filter(p => p.riskLevel === 'LOW').length,
    safe: verified.filter(p => p.riskLevel === 'SAFE').length,
  };

  console.log('\n' + '='.repeat(100));
  console.log('📊 РЕЗУЛЬТАТЫ ПРОВЕРКИ РЕАЛЬНЫХ HEALTH FACTORS');
  console.log('='.repeat(100));
  console.log(`✅ Успешно проверено: ${verified.length} позиций`);
  console.log(`❌ Ошибок проверки: ${errorCount}`);

  console.log('\n⚠️  РЕАЛЬНОЕ РАСПРЕДЕЛЕНИЕ ПО РИСКАМ:');
  console.log(`  💥 LIQUIDATABLE:    ${riskDist.liquidatable} позиций (HF < 1.0) - ГОТОВЫ К ЛИКВИДАЦИИ!`);
  console.log(`  🔴 CRITICAL:        ${riskDist.critical} позиций (HF < 1.1) - Очень близко!`);
  console.log(`  🟠 HIGH:            ${riskDist.high} позиций (HF < 1.3) - Высокий риск`);
  console.log(`  🟡 MEDIUM:          ${riskDist.medium} позиций (HF < 1.5) - Средний риск`);
  console.log(`  🟢 LOW:             ${riskDist.low} позиций (HF < 2.0) - Низкий риск`);
  console.log(`  ⚪ SAFE:            ${riskDist.safe} позиций (HF >= 2.0) - Безопасно`);

  // Показываем самые рискованные
  const risky = verified.filter(p => p.realHealthFactor !== Infinity && p.realHealthFactor < 3.0);

  if (risky.length > 0) {
    console.log('\n' + '='.repeat(100));
    console.log('🎯 ПОЗИЦИИ С РЕАЛЬНЫМ HF < 3.0 (отсортировано по HF):');
    console.log('='.repeat(100));
    console.log('Risk      Address                                        Real HF  Coll.Ratio  LT      Distance');
    console.log('-'.repeat(100));

    risky.forEach(p => {
      const emoji = {
        'LIQUIDATABLE': '💥',
        'CRITICAL': '🔴',
        'HIGH': '🟠',
        'MEDIUM': '🟡',
        'LOW': '🟢',
        'SAFE': '⚪'
      }[p.riskLevel] || '⚪';

      const distance = p.realHealthFactor >= 1.0 ? `${p.distanceToLiquidation.toFixed(1)}%` : 'READY!';

      console.log(
        `${emoji} ${p.riskLevel.padEnd(12)}  ${p.address}  ${p.realHealthFactor.toFixed(3).padEnd(7)}  ${p.collateralRatio.toFixed(2)}x       ${(p.liquidationThreshold * 100).toFixed(0)}%    ${distance}`
      );
    });
  }

  // Показываем примеры где collateral ratio ≠ health factor
  console.log('\n' + '='.repeat(100));
  console.log('💡 ПРИМЕРЫ: почему Collateral Ratio ≠ Health Factor');
  console.log('='.repeat(100));
  console.log('Address                                        Debt     Collateral  C.Ratio  Real HF  LT');
  console.log('-'.repeat(100));

  verified.slice(0, 10).forEach(p => {
    console.log(
      `${p.address}  $${p.totalBorrowUsd.toFixed(0).padEnd(6)}   $${p.totalCollateralUsd.toFixed(0).padEnd(8)}    ${p.collateralRatio.toFixed(2)}x     ${p.realHealthFactor === Infinity ? 'Inf' : p.realHealthFactor.toFixed(2)}     ${(p.liquidationThreshold * 100).toFixed(0)}%`
    );
  });

  console.log('\n📖 ОБЪЯСНЕНИЕ:');
  console.log('   Collateral Ratio = Collateral / Debt (простое деление)');
  console.log('   Health Factor = (Collateral × Liquidation Threshold) / Debt');
  console.log('   Liquidation Threshold зависит от токенов в позиции (обычно 70-85%)');
  console.log('='.repeat(100) + '\n');

  // Сохраняем проверенные данные
  const verifiedSnapshot = {
    timestamp: Date.now(),
    totalPositions: verified.length,
    riskDistribution: riskDist,
    totalBorrowedUsd: verified.reduce((sum, p) => sum + p.totalBorrowUsd, 0),
    totalCollateralUsd: verified.reduce((sum, p) => sum + p.totalCollateralUsd, 0),
    positions: verified,
  };

  fs.writeFileSync('verified_positions.json', JSON.stringify(verifiedSnapshot, null, 2));
  logger.info('Verified positions saved to verified_positions.json');

  // Обновляем healthcare snapshot с ПРАВИЛЬНЫМИ данными
  const healthcareUpdate = {
    timestamp: Date.now(),
    totalBorrowers: verified.length,
    riskDistribution: riskDist,
    totalBorrowedUsd: verifiedSnapshot.totalBorrowedUsd,
    totalCollateralUsd: verifiedSnapshot.totalCollateralUsd,
    averageHealthFactor: verified
      .filter(p => isFinite(p.realHealthFactor))
      .reduce((sum, p) => sum + p.realHealthFactor, 0) / verified.filter(p => isFinite(p.realHealthFactor)).length,
    borrowers: verified.map(p => ({
      address: p.address,
      healthFactor: isFinite(p.realHealthFactor) ? p.realHealthFactor : null,
      totalBorrowUsd: p.totalBorrowUsd,
      totalCollateralUsd: p.totalCollateralUsd,
      distanceToLiquidation: p.distanceToLiquidation,
      riskLevel: p.riskLevel,
    })),
  };

  fs.writeFileSync('healthcare_snapshot.json', JSON.stringify(healthcareUpdate, null, 2));
  logger.info('Healthcare snapshot updated with VERIFIED health factors');

  console.log('✅ Результаты сохранены:');
  console.log('   - verified_positions.json (полные данные)');
  console.log('   - healthcare_snapshot.json (для мониторинга)\n');

  if (riskDist.liquidatable > 0 || riskDist.critical > 0 || riskDist.high > 0) {
    console.log('🚨 ВНИМАНИЕ: Найдены позиции с высоким риском!');
    console.log('   Перезапустите мониторинг: pkill -f periodicHealthMonitor && npm run healthcare:monitor\n');
  }

  process.exit(0);
}

verifyHealthFactors().catch((error) => {
  logger.error('Health factor verification failed', { error });
  process.exit(1);
});

/**
 * Realistic Small Positions Monitor
 * Фильтруем РЕАЛИСТИЧНЫЕ мелкие позиции с разумным соотношением долга к обеспечению
 * Такие позиции могут реально стать ликвидируемыми при падении рынка
 */

import * as fs from 'fs';

interface Position {
  address: string;
  healthFactor: number | null;
  totalBorrowUsd: number;
  totalCollateralUsd: number;
  collateralRatio: number;
}

function analyzeRealisticPositions() {
  // Загружаем все позиции
  const snapshot = JSON.parse(fs.readFileSync('./full_protocol_snapshot.json', 'utf-8'));
  const allPositions: Position[] = snapshot.borrowers.map((b: any) => ({
    address: b.address,
    healthFactor: b.healthFactor,
    totalBorrowUsd: b.totalBorrowUsd,
    totalCollateralUsd: b.totalCollateralUsd,
    collateralRatio: b.totalCollateralUsd / b.totalBorrowUsd,
  }));

  console.log('\n🔍 Анализ РЕАЛИСТИЧНЫХ мелких позиций для капитала $100...\n');

  // КРИТЕРИИ для реалистичных позиций:
  // 1. Малый долг: $50 - $999 (доступно для вашего капитала)
  // 2. Малое обеспечение: < $3000 (реально может упасть в цене)
  // 3. Умеренное соотношение: collateral/debt < 5x (реалистично для ликвидации)

  const realistic = allPositions.filter(p =>
    p.totalBorrowUsd >= 50 &&        // Минимум $50 долга
    p.totalBorrowUsd < 1000 &&       // Максимум $999 долга
    p.totalCollateralUsd < 3000 &&   // Малое обеспечение
    p.collateralRatio < 5            // Не более 5x обеспечения
  );

  const veryRealistic = allPositions.filter(p =>
    p.totalBorrowUsd >= 50 &&
    p.totalBorrowUsd < 1000 &&
    p.totalCollateralUsd < 2000 &&   // Очень малое обеспечение
    p.collateralRatio < 3            // Не более 3x
  );

  const extremelyRealistic = allPositions.filter(p =>
    p.totalBorrowUsd >= 50 &&
    p.totalBorrowUsd < 1000 &&
    p.totalCollateralUsd < 1500 &&   // Критически малое обеспечение
    p.collateralRatio < 2.5          // Близко к минимуму
  );

  // Сортируем по collateralRatio (самые близкие к ликвидации)
  realistic.sort((a, b) => a.collateralRatio - b.collateralRatio);
  veryRealistic.sort((a, b) => a.collateralRatio - b.collateralRatio);
  extremelyRealistic.sort((a, b) => a.collateralRatio - b.collateralRatio);

  console.log('='.repeat(100));
  console.log('📊 СТАТИСТИКА РЕАЛИСТИЧНЫХ ПОЗИЦИЙ');
  console.log('='.repeat(100));
  console.log(`🦐 Все мелкие позиции (<$1K):                    ${allPositions.filter(p => p.totalBorrowUsd < 1000).length} позиций`);
  console.log(`✅ Реалистичные (collateral < $3K, ratio < 5x):  ${realistic.length} позиций`);
  console.log(`⭐ Очень реалистичные (< $2K, ratio < 3x):       ${veryRealistic.length} позиций`);
  console.log(`🎯 ЭКСТРЕМАЛЬНО реалистичные (< $1.5K, < 2.5x):  ${extremelyRealistic.length} позиций`);

  if (extremelyRealistic.length > 0) {
    console.log('\n' + '='.repeat(100));
    console.log('🎯 ЭКСТРЕМАЛЬНО РЕАЛИСТИЧНЫЕ ПОЗИЦИИ (Лучшие кандидаты!):');
    console.log('='.repeat(100));
    console.log('Address                                        Debt       Collateral  Ratio   Distance to Liq');
    console.log('-'.repeat(100));

    extremelyRealistic.forEach(p => {
      const distance = p.collateralRatio > 1 ? `${((1 - 1/p.collateralRatio) * 100).toFixed(1)}%` : 'READY!';
      console.log(
        `${p.address}  $${p.totalBorrowUsd.toFixed(2).padEnd(9)}  $${p.totalCollateralUsd.toFixed(0).padEnd(9)}  ${p.collateralRatio.toFixed(2)}x    ${distance}`
      );
    });

    console.log('\n💡 Эти позиции могут стать ликвидируемыми при падении коллатерала на:');
    extremelyRealistic.slice(0, 5).forEach((p, i) => {
      const dropNeeded = ((1 - 1/p.collateralRatio) * 100).toFixed(1);
      console.log(`   ${i+1}. ${p.address}: падение на ${dropNeeded}% = ликвидация`);
    });
  }

  if (veryRealistic.length > 0) {
    console.log('\n' + '='.repeat(100));
    console.log('⭐ ОЧЕНЬ РЕАЛИСТИЧНЫЕ ПОЗИЦИИ:');
    console.log('='.repeat(100));
    console.log('Address                                        Debt       Collateral  Ratio   Distance');
    console.log('-'.repeat(100));

    veryRealistic.slice(0, 20).forEach(p => {
      const distance = p.collateralRatio > 1 ? `${((1 - 1/p.collateralRatio) * 100).toFixed(1)}%` : 'READY!';
      console.log(
        `${p.address}  $${p.totalBorrowUsd.toFixed(2).padEnd(9)}  $${p.totalCollateralUsd.toFixed(0).padEnd(9)}  ${p.collateralRatio.toFixed(2)}x    ${distance}`
      );
    });
  }

  if (realistic.length > 0 && realistic.length !== veryRealistic.length) {
    console.log('\n' + '='.repeat(100));
    console.log('✅ ВСЕ РЕАЛИСТИЧНЫЕ ПОЗИЦИИ (топ 30):');
    console.log('='.repeat(100));
    console.log('Address                                        Debt       Collateral  Ratio   Distance');
    console.log('-'.repeat(100));

    realistic.slice(0, 30).forEach(p => {
      const distance = p.collateralRatio > 1 ? `${((1 - 1/p.collateralRatio) * 100).toFixed(1)}%` : 'READY!';
      console.log(
        `${p.address}  $${p.totalBorrowUsd.toFixed(2).padEnd(9)}  $${p.totalCollateralUsd.toFixed(0).padEnd(9)}  ${p.collateralRatio.toFixed(2)}x    ${distance}`
      );
    });
  }

  console.log('\n' + '='.repeat(100));
  console.log('📈 СРАВНЕНИЕ С "НЕРЕАЛИСТИЧНЫМИ" ПОЗИЦИЯМИ:');
  console.log('='.repeat(100));

  const unrealistic = allPositions.filter(p =>
    p.totalBorrowUsd < 1000 &&
    (p.totalCollateralUsd >= 3000 || p.collateralRatio >= 5)
  );

  console.log(`\n❌ Нереалистичные (слишком большое обеспечение): ${unrealistic.length} позиций`);
  console.log('   Примеры:');
  unrealistic.sort((a, b) => b.collateralRatio - a.collateralRatio).slice(0, 5).forEach((p, i) => {
    console.log(`   ${i+1}. Долг: $${p.totalBorrowUsd.toFixed(0)}, Обеспечение: $${p.totalCollateralUsd.toFixed(0)}, Ratio: ${p.collateralRatio.toFixed(1)}x`);
  });

  console.log('\n✅ Реалистичные (малое обеспечение, близко к минимуму): ' + realistic.length + ' позиций');
  console.log('='.repeat(100) + '\n');

  // Сохраняем только реалистичные позиции
  const realisticSnapshot = {
    timestamp: Date.now(),
    capitalAvailable: 100,
    criteria: {
      minDebt: 50,
      maxDebt: 999,
      maxCollateral: 3000,
      maxCollateralRatio: 5,
    },
    extremelyRealistic: extremelyRealistic.length,
    veryRealistic: veryRealistic.length,
    realistic: realistic.length,
    positions: realistic.map(p => ({
      address: p.address,
      totalBorrowUsd: p.totalBorrowUsd,
      totalCollateralUsd: p.totalCollateralUsd,
      collateralRatio: p.collateralRatio,
      dropNeededForLiquidation: ((1 - 1/p.collateralRatio) * 100).toFixed(1) + '%',
    })),
  };

  fs.writeFileSync('realistic_small_positions.json', JSON.stringify(realisticSnapshot, null, 2));
  console.log('✅ Реалистичные позиции сохранены в: realistic_small_positions.json\n');

  // Обновляем healthcare snapshot только для реалистичных позиций
  if (realistic.length > 0) {
    const healthcareUpdate = {
      timestamp: Date.now(),
      totalBorrowers: realistic.length,
      riskDistribution: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        safe: realistic.length,
      },
      totalBorrowedUsd: realistic.reduce((sum, p) => sum + p.totalBorrowUsd, 0),
      totalCollateralUsd: realistic.reduce((sum, p) => sum + p.totalCollateralUsd, 0),
      averageHealthFactor: null,
      borrowers: realistic.map(p => ({
        address: p.address,
        healthFactor: p.healthFactor,
        totalBorrowUsd: p.totalBorrowUsd,
        totalCollateralUsd: p.totalCollateralUsd,
        distanceToLiquidation: ((1 - 1/p.collateralRatio) * 100).toFixed(1),
        riskLevel: 'SAFE',
      })),
    };

    fs.writeFileSync('healthcare_snapshot.json', JSON.stringify(healthcareUpdate, null, 2));
    console.log('✅ Healthcare snapshot обновлен для мониторинга ТОЛЬКО реалистичных позиций\n');
  }

  console.log('💡 РЕКОМЕНДАЦИЯ:');
  console.log(`   Перезапустите мониторинг для отслеживания ${realistic.length} реалистичных позиций:`);
  console.log('   pkill -f periodicHealthMonitor && npm run healthcare:monitor\n');
}

analyzeRealisticPositions();

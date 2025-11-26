/**
 * Full Protocol Scan
 * Полное сканирование всех заемщиков Venus Protocol
 * Использует метод getAllBorrowers для получения ВСЕХ активных позиций
 */

import { JsonRpcProvider } from 'ethers';
import { loadConfig } from '../config';
import VenusContracts from '../contracts/VenusContracts';
import HealthFactorCalculator from '../services/monitoring/HealthFactorCalculator';
import { logger } from '../utils/logger';
import * as fs from 'fs';

interface BorrowerInfo {
  address: string;
  healthFactor: number;
  totalBorrowUsd: number;
  totalCollateralUsd: number;
  borrowMarkets: string[];
  collateralMarkets: string[];
}

async function fullProtocolScan() {
  const config = loadConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  const venusContracts = new VenusContracts(provider, config.venus.comptroller);
  const healthCalculator = new HealthFactorCalculator(venusContracts);

  await venusContracts.initialize();
  logger.info('Full protocol scanner initialized');

  const allVTokens = await venusContracts.getAllVTokens();

  console.log(`\n🔍 Scanning all ${allVTokens.length} Venus markets for borrowers...`);
  console.log('This may take several minutes...\n');

  const allBorrowers = new Set<string>();
  let totalScanned = 0;

  // Сканируем каждый рынок для получения всех заемщиков
  for (let i = 0; i < allVTokens.length; i++) {
    const vTokenAddress = allVTokens[i];

    try {
      const vToken = venusContracts.getVToken(vTokenAddress);
      const symbol = await vToken.symbol();

      // Получаем текущий блок
      const currentBlock = await provider.getBlockNumber();

      // Сканируем события за больший период (последние 200K блоков ≈ 7 дней)
      // Разбиваем на чанки по 5000 блоков
      const totalBlocks = 200000;
      const chunkSize = 5000;
      const marketBorrowers = new Set<string>();

      for (let offset = 0; offset < totalBlocks; offset += chunkSize) {
        const fromBlock = Math.max(1, currentBlock - totalBlocks + offset);
        const toBlock = Math.min(currentBlock, fromBlock + chunkSize);

        try {
          // Borrow events
          const borrowFilter = vToken.filters.Borrow();
          const borrowEvents = await vToken.queryFilter(borrowFilter, fromBlock, toBlock);

          for (const event of borrowEvents) {
            if ('args' in event && event.args?.borrower) {
              marketBorrowers.add(event.args.borrower);
              allBorrowers.add(event.args.borrower);
            }
          }

          // RepayBorrow events - тоже могут содержать активных заемщиков
          const repayFilter = vToken.filters.RepayBorrow();
          const repayEvents = await vToken.queryFilter(repayFilter, fromBlock, toBlock);

          for (const event of repayEvents) {
            if ('args' in event && event.args?.borrower) {
              marketBorrowers.add(event.args.borrower);
              allBorrowers.add(event.args.borrower);
            }
          }

          await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
          logger.warn(`Failed to scan chunk ${fromBlock}-${toBlock} for ${symbol}`, { error });
        }
      }

      totalScanned++;
      console.log(`[${totalScanned}/${allVTokens.length}] ${symbol}: ${marketBorrowers.size} borrowers found (Total: ${allBorrowers.size})`);

      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      logger.warn(`Failed to scan market ${vTokenAddress}`, { error });
    }
  }

  console.log(`\n✅ Scan complete! Found ${allBorrowers.size} unique addresses with borrow activity`);
  console.log(`\n🔍 Now checking which positions are still active (have debt > 0)...\n`);

  const activeBorrowers: BorrowerInfo[] = [];
  const borrowersArray = Array.from(allBorrowers);

  for (let i = 0; i < borrowersArray.length; i++) {
    const borrower = borrowersArray[i];

    try {
      const position = await healthCalculator.getPositionDetails(borrower);

      // Проверяем что позиция активна (есть долг)
      if (position && position.debtValueUsd > 0) {
        activeBorrowers.push({
          address: borrower,
          healthFactor: position.healthFactor,
          totalBorrowUsd: position.debtValueUsd,
          totalCollateralUsd: position.collateralValueUsd,
          borrowMarkets: position.borrowTokens,
          collateralMarkets: position.collateralTokens,
        });
      }

      if ((i + 1) % 10 === 0) {
        console.log(`  Progress: ${i + 1}/${borrowersArray.length} checked (${activeBorrowers.length} active)`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logger.warn(`Failed to check borrower ${borrower}`, { error });
    }
  }

  console.log(`\n✅ Found ${activeBorrowers.length} ACTIVE borrowers with open positions`);

  // Сортируем по размеру займа
  activeBorrowers.sort((a, b) => b.totalBorrowUsd - a.totalBorrowUsd);

  // Анализ по размерам
  const whales = activeBorrowers.filter(b => b.totalBorrowUsd >= 100000); // >= $100K
  const large = activeBorrowers.filter(b => b.totalBorrowUsd >= 10000 && b.totalBorrowUsd < 100000); // $10K-$100K
  const medium = activeBorrowers.filter(b => b.totalBorrowUsd >= 1000 && b.totalBorrowUsd < 10000); // $1K-$10K
  const small = activeBorrowers.filter(b => b.totalBorrowUsd < 1000); // < $1K

  const totalBorrowed = activeBorrowers.reduce((sum, b) => sum + b.totalBorrowUsd, 0);
  const totalCollateral = activeBorrowers.reduce((sum, b) => sum + b.totalCollateralUsd, 0);

  // Анализ по health factor
  const critical = activeBorrowers.filter(b => b.healthFactor < 1.1);
  const high = activeBorrowers.filter(b => b.healthFactor >= 1.1 && b.healthFactor < 1.3);
  const medium_risk = activeBorrowers.filter(b => b.healthFactor >= 1.3 && b.healthFactor < 1.5);
  const low = activeBorrowers.filter(b => b.healthFactor >= 1.5 && b.healthFactor < 2.0);
  const safe = activeBorrowers.filter(b => b.healthFactor >= 2.0);

  console.log('\n' + '='.repeat(100));
  console.log('📊 FULL VENUS PROTOCOL ANALYSIS');
  console.log('='.repeat(100));
  console.log(`📅 Timestamp: ${new Date().toLocaleString()}`);
  console.log(`👥 Total Active Borrowers: ${activeBorrowers.length}`);
  console.log(`💰 Total Borrowed: $${totalBorrowed.toLocaleString()}`);
  console.log(`🏦 Total Collateral: $${totalCollateral.toLocaleString()}`);
  console.log(`📈 Collateral Ratio: ${(totalCollateral / totalBorrowed).toFixed(2)}x`);

  console.log('\n💵 POSITION SIZE DISTRIBUTION:');
  console.log(`  🐋 Whales (>=$100K):     ${whales.length.toString().padStart(4)} positions ($${whales.reduce((s,b) => s+b.totalBorrowUsd, 0).toLocaleString()})`);
  console.log(`  🐬 Large ($10K-$100K):   ${large.length.toString().padStart(4)} positions ($${large.reduce((s,b) => s+b.totalBorrowUsd, 0).toLocaleString()})`);
  console.log(`  🐟 Medium ($1K-$10K):    ${medium.length.toString().padStart(4)} positions ($${medium.reduce((s,b) => s+b.totalBorrowUsd, 0).toLocaleString()})`);
  console.log(`  🦐 Small (<$1K):         ${small.length.toString().padStart(4)} positions ($${small.reduce((s,b) => s+b.totalBorrowUsd, 0).toLocaleString()})`);

  console.log('\n⚠️  RISK DISTRIBUTION:');
  console.log(`  🔴 CRITICAL (HF<1.1):    ${critical.length.toString().padStart(4)} positions`);
  console.log(`  🟠 HIGH (HF 1.1-1.3):    ${high.length.toString().padStart(4)} positions`);
  console.log(`  🟡 MEDIUM (HF 1.3-1.5):  ${medium_risk.length.toString().padStart(4)} positions`);
  console.log(`  🟢 LOW (HF 1.5-2.0):     ${low.length.toString().padStart(4)} positions`);
  console.log(`  ⚪ SAFE (HF>=2.0):        ${safe.length.toString().padStart(4)} positions`);

  // Топ-20 крупнейших позиций
  console.log('\n' + '='.repeat(100));
  console.log('🐋 TOP 20 LARGEST POSITIONS:');
  console.log('='.repeat(100));
  console.log('Rank  Address                                        Debt (USD)       Collateral (USD)  HF');
  console.log('-'.repeat(100));

  activeBorrowers.slice(0, 20).forEach((b, i) => {
    const rank = `#${(i + 1).toString().padStart(2)}`;
    const debt = `$${b.totalBorrowUsd.toLocaleString()}`.padEnd(16);
    const collateral = `$${b.totalCollateralUsd.toLocaleString()}`.padEnd(18);
    const hf = isFinite(b.healthFactor) ? b.healthFactor.toFixed(2) : '∞';
    console.log(`${rank}    ${b.address}  ${debt} ${collateral}${hf}`);
  });

  // Показываем рискованные позиции
  if (critical.length > 0 || high.length > 0) {
    console.log('\n' + '='.repeat(100));
    console.log('🚨 AT-RISK POSITIONS:');
    console.log('='.repeat(100));

    const atRisk = [...critical, ...high].sort((a, b) => a.healthFactor - b.healthFactor);
    atRisk.forEach(b => {
      const risk = b.healthFactor < 1.1 ? '🔴 CRITICAL' : '🟠 HIGH';
      console.log(`${risk} ${b.address} - HF: ${b.healthFactor.toFixed(3)}, Debt: $${b.totalBorrowUsd.toLocaleString()}`);
    });
  }

  console.log('\n' + '='.repeat(100));

  // Сохраняем результаты
  const fullSnapshot = {
    timestamp: Date.now(),
    totalBorrowers: activeBorrowers.length,
    totalBorrowedUsd: totalBorrowed,
    totalCollateralUsd: totalCollateral,
    sizeDistribution: {
      whales: whales.length,
      large: large.length,
      medium: medium.length,
      small: small.length,
    },
    riskDistribution: {
      critical: critical.length,
      high: high.length,
      medium: medium_risk.length,
      low: low.length,
      safe: safe.length,
    },
    borrowers: activeBorrowers.map(b => ({
      address: b.address,
      healthFactor: isFinite(b.healthFactor) ? Math.round(b.healthFactor * 1000) / 1000 : null,
      totalBorrowUsd: Math.round(b.totalBorrowUsd * 100) / 100,
      totalCollateralUsd: Math.round(b.totalCollateralUsd * 100) / 100,
      borrowMarkets: b.borrowMarkets.length,
      collateralMarkets: b.collateralMarkets.length,
    })),
  };

  fs.writeFileSync('full_protocol_snapshot.json', JSON.stringify(fullSnapshot, null, 2));
  logger.info('Full protocol snapshot saved to full_protocol_snapshot.json');

  // Обновляем healthcare snapshot для использования в мониторинге
  fs.writeFileSync('healthcare_snapshot.json', JSON.stringify({
    timestamp: Date.now(),
    totalBorrowers: activeBorrowers.length,
    riskDistribution: {
      critical: critical.length,
      high: high.length,
      medium: medium_risk.length,
      low: low.length,
      safe: safe.length,
    },
    totalBorrowedUsd: totalBorrowed,
    totalCollateralUsd: totalCollateral,
    averageHealthFactor: activeBorrowers.reduce((s,b) => s + (isFinite(b.healthFactor) ? b.healthFactor : 0), 0) / activeBorrowers.length,
    borrowers: activeBorrowers.map(b => ({
      address: b.address,
      healthFactor: isFinite(b.healthFactor) ? Math.round(b.healthFactor * 1000) / 1000 : null,
      totalBorrowUsd: Math.round(b.totalBorrowUsd * 100) / 100,
      totalCollateralUsd: Math.round(b.totalCollateralUsd * 100) / 100,
      distanceToLiquidation: isFinite(b.healthFactor) && b.healthFactor > 1
        ? Math.round((1 - 1/b.healthFactor) * 10000) / 100
        : 0,
      riskLevel: b.healthFactor < 1.1 ? 'CRITICAL'
        : b.healthFactor < 1.3 ? 'HIGH'
        : b.healthFactor < 1.5 ? 'MEDIUM'
        : b.healthFactor < 2.0 ? 'LOW'
        : 'SAFE',
    })),
  }, null, 2));

  logger.info('Updated healthcare_snapshot.json with full scan results');

  console.log('\n✅ Full protocol scan complete!');
  console.log(`📁 Results saved to full_protocol_snapshot.json`);
  console.log(`📁 Healthcare snapshot updated for monitoring\n`);

  process.exit(0);
}

fullProtocolScan().catch((error) => {
  logger.error('Full protocol scan failed', { error });
  process.exit(1);
});

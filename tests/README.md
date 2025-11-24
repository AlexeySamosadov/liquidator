## Test Structure
- `tests/unit/ProfitabilityCalculator.test.ts` — Unit tests for gas estimation, flash loan fee calculation, and profitability analysis logic.
- `tests/unit/TransactionBuilder.test.ts` — Unit tests for EIP-1559 gas parameter building and gas limit estimation.
- `tests/integration/profitability-integration.test.ts` — Integration tests covering full profitability flow across calculators and gas builder.

## Running Tests
```bash
# Run profitability tests
npm run test:profitability

# Run profitability tests in watch mode
npm run test:profitability:watch

# Run profitability tests with coverage
npm run test:profitability:coverage

# Run profitability integration tests
npm run test:profitability:integration

# Run all profitability tests
npm run test:profitability:all
```

### Profitability & Gas Tests
Tests for components responsible for profitability calculation and gas parameters:

**ProfitabilityCalculator:**
- Gas estimation (standard/flash loan modes, fallback, contract calls)
- Flash loan fee calculation (decimals 6/8/18)
- Profitability analysis (gross/net profit, margin, isProfitable)
- Lightweight gas estimation for candidates
- Edge cases (Infinity, NaN, overflow, zero debt, missing metadata)

**TransactionBuilder:**
- EIP-1559 gas params (multiplier, caps, fallback)
- Gas limit estimation (buffer, error handling)
- Integration with provider.getFeeData()

**Integration Tests:**
- Full cycle: estimateGas → analyzeProfitability
- Token decimals variations (USDT=6, WBTC=8, WBNB=18)
- Standard vs flash loan mode comparison
- Real-world scenarios (profitable/unprofitable)
- Gas price variations (low/high/cap exceeded)

### LiquidationEngine & Strategy Tests
Тесты для компонентов, отвечающих за оркестрацию ликвидаций и выбор стратегии:

**LiquidationStrategy:**
- Strategy selection (standard vs flash loan на основе баланса и прибыльности)
- Strategy validation (проверка баланса, конфигурации, минимальной прибыли)
- Balance checks (native BNB vs ERC20 tokens)
- Profitability comparison между режимами
- Edge cases (различные decimals, большие/маленькие суммы, ошибки)

**LiquidationEngine:**
- Initialization (зависимости, liquidation bonus, risk manager)
- Full execution flow (strategy → risk → gas → execution → collateral)
- Risk validation integration (emergency stop, daily loss, gas price, tokens, balance, health factor)
- Gas estimation and profitability analysis
- Standard vs flash loan execution
- Dry-run mode
- Collateral swap handling (AUTO_SELL, HOLD, CONFIGURABLE)
- Statistics tracking (attempts, success/failure, profit, gas costs, realized USD)
- Error handling и recovery

**Integration Tests:**
- Full liquidation flows (standard и flash loan)
- Risk management scenarios (emergency stop, daily loss, gas spikes, token filters)
- Profitability scenarios (profitable/unprofitable, gas costs, flash loan fees)
- Collateral swap scenarios (strategии, price impact, swap failures)
- Dry-run mode
- Statistics tracking across multiple liquidations
- Real-world scenarios (различные размеры позиций, decimals, gas prices)

**Running Tests:**
```bash
# Run engine tests
npm run test:engine

# Run engine tests in watch mode
npm run test:engine:watch

# Run engine tests with coverage
npm run test:engine:coverage

# Run engine integration tests
npm run test:engine:integration

# Run all engine tests
npm run test:engine:all
```

**Test Utilities:**
- Mock liquidators (StandardLiquidator, FlashLoanLiquidator)
- Mock dependencies (ProfitabilityCalculator, TransactionBuilder, RiskManager, CollateralManager)
- Result factories (LiquidationResult, SwapResult, RiskValidationResult, GasEstimate, ProfitabilityAnalysis)
- Engine-specific assertions (strategy selection, validation, stats, collateral swaps, dry-run)

**Coverage Goals:**
- LiquidationStrategy: >95%
- LiquidationEngine: >95%
- Integration scenarios: все критичные flows покрыты

### Monitoring Tests
Тесты для компонентов, отвечающих за обнаружение и отслеживание ликвидируемых позиций:

**HealthFactorCalculator:**
- Расчет health factor (shortfall, liquidity, error codes)
- getPositionDetails (collateral/debt aggregation, token decimals, USD conversions)
- isLiquidatable (HF threshold, min position size)
- getLiquidationIncentive (mantissa conversion)
- Edge cases (Infinity, NaN, zero debt, non-finite values, contract errors)

**PositionTracker:**
- updatePosition (healthy/liquidatable transitions, recovery)
- calculateLiquidationDetails (repay/seize selection, profit estimation, gas costs)
- getLiquidatablePositions (sorting by profit, filtering by size)
- getStats (totalAccountsTracked, liquidatablePositions, averageHealthFactor)
- Price resolution (underlying, vToken, derived prices)
- Edge cases (non-finite profits, missing prices, different decimals)

**MonitoringService:**
- Initialization (subservices creation: HealthFactorCalculator, PositionTracker, EventMonitor, PollingService, ProfitabilityCalculator)
- Lifecycle (start/stop, isActive)
- Integration (EventMonitor → PollingService → PositionTracker → liquidatable positions)
- Stats aggregation (from tracker, polling, events)
- Error handling (subservice failures)

**Integration Tests:**
- Full discovery → tracking → liquidatable flow
- Position recovery scenarios (liquidatable → healthy)
- Shortfall vs liquidity scenarios
- Error code handling (VToken, Oracle, Comptroller)
- Token decimals variations (6, 8, 18)
- Gas cost estimation integration
- Healthy polls before drop
- Min position size filtering
- Non-finite values handling
- Real-world scenarios (mixed portfolios, multiple positions)

**Running Tests:**
```bash
# Run monitoring tests
npm run test:monitoring

# Run monitoring tests in watch mode
npm run test:monitoring:watch

# Run monitoring tests with coverage
npm run test:monitoring:coverage

# Run monitoring integration tests
npm run test:monitoring:integration

# Run all monitoring tests
npm run test:monitoring:all
```

**Test Utilities:**
- Mock monitoring services (MockHealthFactorCalculator, MockPositionTracker, MockEventMonitor, MockPollingService)
- Monitoring-specific assertions (expectHealthFactorValid, expectPositionDetailsValid, expectMonitoringStats)
- Test data constants (HEALTHY_HF, LIQUIDATABLE_HF, INFINITY_HF, NAN_HF, liquidity/shortfall values)

**Coverage Goals:**
- HealthFactorCalculator: >95%
- PositionTracker: >95%
- MonitoringService: >95%
- Integration scenarios: все критичные flows покрыты

### DEX & Collateral Management Tests
Тесты для компонентов, отвечающих за управление залогом после ликвидации, swap execution, price impact checks, и route optimization:

**CollateralManager:**
- Стратегии AUTO_SELL, HOLD, CONFIGURABLE
- Threshold minSwapAmountUsd, stablecoin skip
- Интеграция с RouteOptimizer, PriceImpactChecker, SwapExecutor
- Stats tracking (attempted/succeeded/failed, totalUsdSwapped)
- Token decimals handling (6/8/18) и edge cases (dust, missing routes, impact rejection)

**SwapExecutor:**
- Single-hop (exactInputSingle) и multi-hop (exactInput) swaps
- Token approvals, path encoding, minAmountOut derivation
- Transfer-log parsing для amountOut
- Error handling (reverts, missing logs)

**PriceImpactChecker:**
- Расчет impactPercent oracle vs DEX, maxPriceImpact guardrails
- Min amount out через USD сохранение + slippage
- Slippage validation, priceImpact enrichment
- Edge cases: zero prices, extreme impact, decimals 6/8/18

**RouteOptimizer:**
- Поиск лучшего маршрута (direct vs multi-hop via WBNB/USDT/BUSD)
- Fee tier selection по ликвидности
- Multi-hop estimation и pool caching
- Edge cases: no pools, invalid paths

**Integration Tests:**
- Полный collateral flow (AUTO_SELL) с route + impact + swap
- CONFIGURABLE/HOLD ветки
- Token decimals и error handling

**Running Tests:**
```bash
npm run test:dex               # unit
npm run test:dex:watch
npm run test:dex:coverage
npm run test:dex:integration
npm run test:dex:all           # unit + integration
npm run test:dex:collateral
npm run test:dex:swap
npm run test:dex:impact
npm run test:dex:route
```

### Test Utilities
- `MockPriceService.getBnbPriceUsd()` — Mock for fetching BNB price.
- `tests/utils/testData.ts` — Constants for gas and fee scenarios (DEFAULT_MAX_FEE_PER_GAS, FLASH_LOAN_FEE_BPS, etc.).

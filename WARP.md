# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

**Liqvidator** is a liquidation bot for DeFi protocols (Venus on BNB Chain, GMX V2, Aave V3) with hybrid capital + flash loan strategies. Written in TypeScript with ethers.js v5, it monitors positions via event-driven tracking and polling, then executes liquidations when profitable after gas costs and risk checks.

Primary target: **Venus Protocol** on BNB Chain (56) with optional flash loans from PancakeSwap V3.

## Quick Start Commands

### Build and Run
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled bot (node dist/index.js)
npm run dev          # Run with ts-node (development)
```

### Testing
```bash
npm test             # Run all Jest tests
```

Note: The README mentions additional test scripts (e.g., `npm run test:unit`, `test:integration`, `test:liquidators`, `test:monitoring`, `test:dex`, `test:engine`) but these are not currently defined in package.json. If you need to run specific test suites, use Jest's pattern matching:

```bash
npx jest tests/unit                    # Run unit tests
npx jest tests/integration             # Run integration tests
npx jest StandardLiquidator            # Run specific test file
npx jest --watch                       # Watch mode
npx jest --coverage                    # Coverage report
```

### Configuration
```bash
cp .env.example .env                   # Create config from template
```

**Critical:** Private keys in `.env` must be 64 hex characters **without** `0x` prefix. Scripts will reject keys with `0x`.

### Development Scripts

Many helper scripts exist in `src/scripts/`. Run them with ts-node:

```bash
# Position monitoring and analysis
npx ts-node src/scripts/findRiskyPositions.ts
npx ts-node src/scripts/monitorPosition.ts
npx ts-node src/scripts/analyzePosition.ts
npx ts-node src/scripts/checkBalance.ts
npx ts-node src/scripts/getUserTokens.ts

# Protocol scanning
npx ts-node src/scripts/fullProtocolScan.ts
npx ts-node src/scripts/checkRandomAccounts.ts

# Transaction/liquidation analysis
npx ts-node src/scripts/analyzeTx.ts
npx ts-node src/scripts/analyzeLiquidations.ts

# Multi-chain/protocol support
npx ts-node src/scripts/monitorAaveComplete.ts
npx ts-node src/scripts/runAaveLiquidationBot.ts
```

## Architecture

### Core Components

**Entry Point:** `src/index.ts`
- Initializes provider (JsonRpcProvider, not WebSocket), wallet, Venus contracts
- Creates service graph: `VenusContracts` → `PriceService` → `MonitoringService` / `LiquidationEngine` → `ExecutionService`
- Supports three monitoring modes via `MONITORING_MODE`:
  - `ENABLED`: Full event + polling (default)
  - `PROTOCOL_SCAN`: Comprehensive position scanning without events
  - `LIQUIDATION_ONLY`: Snapshot-driven, minimal monitoring
  - `DISABLED`: No monitoring, manual triggers only

**Service Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         VenusContracts                          │
│            (Comptroller, Oracle, vToken wrappers)               │
└────────┬────────────────────────────────────────┬───────────────┘
         │                                        │
         ├────────────────────┐                   │
         │                    │                   │
         v                    v                   v
┌──────────────────┐  ┌────────────────┐  ┌─────────────────────┐
│  PriceService    │  │ HealthFactor   │  │  LiquidationEngine  │
│  (Oracle prices) │  │   Calculator   │  │  (Strategy + Exec)  │
└────────┬─────────┘  └────────┬───────┘  └──────────┬──────────┘
         │                     │                      │
         └──────┬──────────────┘                      │
                │                                     │
         ┌──────v─────────────┐              ┌───────v───────────┐
         │ MonitoringService  │              │ StandardLiquidator│
         │ (Events+Polling)   │              │ FlashLoanLiquidator│
         │   ├─ EventMonitor  │              │ CollateralManager │
         │   ├─ PollingService│              │ RiskManager       │
         │   └─ PositionTracker│             └───────────────────┘
         └──────┬─────────────┘
                │
         ┌──────v─────────────┐
         │ ExecutionService   │
         │ (Retry/Cooldown)   │
         └────────────────────┘
```

### Service Layer (`src/services/`)

**liquidation/**
- `LiquidationEngine`: Orchestrates strategy selection, risk checks, gas estimation, execution, collateral swaps
- `LiquidationStrategy`: Selects STANDARD vs FLASH_LOAN based on balance + profitability
- `StandardLiquidator`: Uses wallet balance to call `vToken.liquidateBorrow()`
- `FlashLoanLiquidator`: Prepares PancakeSwap V3 flash loan params (requires deployed contract)
- `ProfitabilityCalculator`: Estimates gas costs, flash loan fees, net profit
- `TransactionBuilder`: Builds EIP-1559 gas params with multipliers and caps

**monitoring/**
- `MonitoringService`: Combines event-based discovery with health factor polling
  - `EventMonitor`: Scans Borrow/Repay/Liquidate events to discover accounts
  - `PollingService`: Periodically checks health factors, batched to avoid RPC limits
  - `PositionTracker`: Maintains liquidatable positions sorted by profit, handles healthy→liquidatable transitions
  - `HealthFactorCalculator`: Calls comptroller.getAccountLiquidity() and computes HF
- `ProtocolScanService`: Alternative to event-driven; scans all Venus positions systematically

**execution/**
- `ExecutionService`: Consumes liquidatable positions from MonitoringService
  - Implements retry logic (exponential backoff) and cooldowns after success
  - Checks emergency stop and daily loss limits before each attempt
  - Runs on interval (default 30s via `EXECUTION_INTERVAL_MS`)

**risk/**
- `RiskManager`: Pre-execution validation
  - Emergency stop flag (`emergency_stop.flag` file)
  - Daily loss limits (`MAX_DAILY_LOSS_USD`, tracked in `daily_stats.json`)
  - Gas price caps, token blacklist/whitelist, balance sufficiency, health factor revalidation

**dex/** (Collateral Management)
- `CollateralManager`: Handles seized collateral after liquidation (AUTO_SELL | HOLD | CONFIGURABLE)
- `SwapExecutor`: Executes PancakeSwap V3 single-hop or multi-hop swaps
- `PriceImpactChecker`: Validates oracle vs DEX price deviation, enforces `MAX_PRICE_IMPACT`
- `RouteOptimizer`: Finds best swap route (direct, via WBNB, USDT, BUSD)

**pricing/**
- `PriceService`: Fetches token prices from Venus Oracle, BNB price via oracle, converts amounts to USD

**protocol/**
- `ProtocolPositionScanner`: Systematic scanning across all vToken holders (used by ProtocolScanService)

**transaction/**
- `PrivateTransactionService`: Support for bloXroute/private RPC relays (advanced MEV protection)

**gmx/** & **aave/**
- Experimental multi-protocol support for GMX V2 and Aave V3. Not production-ready.

### Configuration (`src/config/`)

- `index.ts`: Loads and validates `.env`, exports `BotConfig`
- `chains.ts`: Chain ID and RPC constants
- `tokens.ts`: Token addresses (USDT, BUSD, WBNB, etc.), default swap configurations
- `vTokens.ts`: Venus market addresses (vBNB, vUSDT, etc.)

### Contracts (`src/contracts/`)

- `abis/`: ABI JSON files (Comptroller, VToken, PancakeSwap, etc.)
- `interfaces/`: TypeScript wrappers for contract interactions
- `index.ts`: `VenusContracts` class - initializes Comptroller, fetches all vTokens, provides contract instances

### Types (`src/types/`)

Key types:
- `BotConfig`: Complete bot configuration
- `LiquidatablePosition`: borrower, healthFactor, collateral/debt details, estimated profit
- `LiquidationResult`: success, mode, profit, gas costs, tx receipt
- `LiquidationMode`: STANDARD | FLASH_LOAN
- `CollateralStrategy`: AUTO_SELL | HOLD | CONFIGURABLE
- `MonitoringMode`: ENABLED | PROTOCOL_SCAN | LIQUIDATION_ONLY | DISABLED
- `VenusPosition`, `GMXPosition`: Protocol-specific position structures

## Configuration Deep Dive

**Risk Management Parameters:**
- `MIN_PROFIT_USD`: Minimum net profit threshold (after gas)
- `MAX_POSITION_SIZE_USD`: Skip positions larger than this
- `TOKEN_BLACKLIST`: Comma-separated addresses to never liquidate
- `TOKEN_WHITELIST`: If set, ONLY liquidate these tokens (overrides blacklist)
- `MAX_DAILY_LOSS_USD`: Bot auto-pauses when daily loss exceeds this ($50 default)
- `EMERGENCY_STOP_FILE`: Create `./emergency_stop.flag` to manually pause bot
- `DRY_RUN`: Simulate liquidations without sending transactions

**Gas Configuration:**
- `GAS_PRICE_MULTIPLIER`: Multiplier over base fee (1.2 = +20%)
- `MAX_GAS_PRICE_GWEI`: Hard cap; bot skips execution if exceeded

**Flash Loan Setup (Optional):**
- `USE_FLASH_LOANS=true`: Enable flash loan mode for large positions
- `FLASH_LIQUIDATOR_CONTRACT`: Address of deployed flash liquidator contract (Solidity contract not included in repo)
- `PANCAKESWAP_V3_FACTORY`: Factory address for finding flash loan pools
- `FLASH_LOAN_FEE_BPS`: Fee in basis points (500 = 0.05%)

**Collateral Strategies:**
- `AUTO_SELL`: Automatically swap seized collateral to `PREFERRED_STABLECOIN` via PancakeSwap V3
- `HOLD`: Keep collateral in wallet
- `CONFIGURABLE`: Per-token rules defined in `src/config/tokens.ts`
- `SLIPPAGE_TOLERANCE`: Max slippage for swaps (0.02 = 2%)
- `MAX_PRICE_IMPACT`: Max oracle-vs-DEX price deviation (0.03 = 3%)
- `MIN_SWAP_AMOUNT_USD`: Skip swaps below this amount (dust)

**Monitoring Tuning:**
- `MONITORING_MODE`: ENABLED | PROTOCOL_SCAN | LIQUIDATION_ONLY | DISABLED
- `POLLING_INTERVAL_MS`: How often to check tracked accounts (30000 = 30s)
- `POLLING_BATCH_SIZE`: Max accounts per polling batch (avoid RPC limits)
- `ENABLE_HISTORICAL_SCAN`: Scan past events on startup (disable for production)
- `HISTORICAL_SCAN_BLOCKS`: Depth for historical event scan (500 default)

**Execution Loop:**
- `EXECUTION_INTERVAL_MS`: How often to attempt liquidations (30000 = 30s)
- `EXECUTION_MAX_RETRIES`: Max retry attempts for failed liquidations
- `EXECUTION_BASE_RETRY_DELAY_MS`: Initial backoff delay (60000 = 1 min)
- `EXECUTION_MAX_RETRY_DELAY_MS`: Max backoff cap (600000 = 10 min)
- `EXECUTION_SUCCESS_COOLDOWN_MS`: Cooldown after successful liquidation (300000 = 5 min)

**Logging:**
- `LOG_LEVEL`: error | warn | info | debug
- `LOG_TO_FILE`: Write logs to `./logs/` directory
- `STATS_LOGGING_INTERVAL_MS`: How often to log stats (60000 = 1 min)

## Testing

Tests use Jest and are organized in `tests/`:
- `tests/unit/`: Unit tests for individual classes (Liquidators, ProfitabilityCalculator, etc.)
- `tests/integration/`: Integration tests for component interactions
- `tests/e2e/`: End-to-end tests (full bot lifecycle)
- `tests/mocks/`: Mock contracts and services
- `tests/utils/`: Test utilities and factories

**Coverage Goals:** >90% for core liquidation and monitoring services.

**Mocks Available:**
- `MockERC20`, `MockVToken`, `MockVenusContracts`, `MockSigner`, `MockProvider`
- `MockPancakeFactory`, `MockPancakePool`, `MockLiquidator`
- Use `createFullMockEnvironment()` and `createLiquidatablePosition()` from `tests/utils/`

## Development Workflow

### Adding New Features

1. **Liquidation Strategy Changes:**
   - Modify `LiquidationStrategy.ts` for strategy selection logic
   - Update `ProfitabilityCalculator.ts` for cost/benefit analysis
   - Add risk checks in `RiskManager.ts`
   - Write unit tests in `tests/unit/` and integration tests in `tests/integration/`

2. **New Token/Market Support:**
   - Add token addresses to `src/config/tokens.ts`
   - Add vToken mappings to `src/config/vTokens.ts`
   - Update `DEFAULT_TOKEN_CONFIGS` if custom swap behavior needed

3. **Multi-Protocol Support:**
   - See `src/services/gmx/` and `src/services/aave/` for examples
   - Implement protocol-specific calculator, executor, monitoring
   - Update `BotConfig` in `src/types/` to support new protocol addresses

4. **Monitoring Improvements:**
   - Modify `EventMonitor.ts` for event scanning logic
   - Adjust `PollingService.ts` for batching/retry behavior
   - Update `PositionTracker.ts` for position lifecycle management

### Code Patterns

**Error Handling:**
- Services use `try/catch` with detailed error logging via `logger`
- Failed liquidations return `LiquidationResult` with `success: false` and `error` message
- Monitoring services continue on errors; execution service logs and retries

**State Management:**
- `ExecutionService` maintains retry states and cooldowns in-memory (Map)
- `RiskManager` tracks daily stats in `daily_stats.json` (reset at UTC midnight)
- Emergency stop uses file flag (`emergency_stop.flag`)

**Gas Estimation:**
- Two-phase: lightweight candidate estimation, then full estimation before execution
- EIP-1559 params built by `TransactionBuilder` with multiplier and caps
- Gas costs always factored into profitability analysis

**Contract Interactions:**
- Use ethers.js v5 (not v6) - note different import patterns
- All contracts wrapped in classes with typed methods
- Provider is `JsonRpcProvider` (HTTP/HTTPS only, no WebSocket support currently)

**Decimal Handling:**
- Venus uses 18-decimal mantissa (1e18)
- Token decimals vary: USDT=6, WBTC=8, WBNB=18
- Always convert via `formatUnits(amount, decimals)` before USD calculations
- ProfitabilityCalculator handles decimal conversions internally

## Important Constraints

1. **RPC Provider:** Only HTTP/HTTPS endpoints supported. WebSocket URLs (`wss://`) will fail.
2. **Private Keys:** Must be 64 hex chars **without** `0x` prefix in `.env`.
3. **Flash Loan Contract:** `FLASH_LIQUIDATOR_CONTRACT` is optional. If empty, bot operates in STANDARD mode only. The Solidity contract for flash liquidations is not included in this repository.
4. **Testing on Mainnet:** Always start with `DRY_RUN=true` and small limits. Monitor `daily_stats.json` for losses.
5. **Emergency Stop Semantics:**
   - `pause()` in `ExecutionService` keeps retry/backoff state; `resume()` continues with existing delays
   - `stop()`/`start()` clears retry history for a clean slate
6. **Multi-Protocol Support:** GMX and Aave integrations are experimental and not production-ready.
7. **Node.js Version:** Requires Node.js >= 18.0.0

## Security Reminders

- Never commit `.env` file
- Use dedicated bot wallet, not personal funds
- Start with small capital ($100-200) and scale gradually
- Regularly withdraw profits to cold storage
- Always test config changes in `DRY_RUN=true` mode first
- Monitor `MAX_DAILY_LOSS_USD` and emergency stop flags

## References

- [README.md](README.md): User-facing setup and operational guide
- [SETUP_GUIDE.md](SETUP_GUIDE.md): Detailed step-by-step configuration
- [tests/README.md](tests/README.md): Test structure and running tests
- Venus Protocol: https://app.venus.io
- PancakeSwap V3: https://pancakeswap.finance
- BSCScan: https://bscscan.com

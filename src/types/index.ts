import { BigNumberish } from 'ethers';

export type Address = string;
export type LowercaseAddress = Lowercase<Address>;
export type PositionKey = string;
export type TokenAmount = {
  token: Address;
  amount: BigNumberish;
};

export enum CollateralStrategy {
  AUTO_SELL = 'AUTO_SELL',
  HOLD = 'HOLD',
  CONFIGURABLE = 'CONFIGURABLE',
}

export enum LiquidationMode {
  STANDARD = 'STANDARD',
  FLASH_LOAN = 'FLASH_LOAN',
  HYBRID = 'HYBRID',
}

export enum LogLevel {
  INFO = 'info',
  DEBUG = 'debug',
  WARN = 'warn',
  ERROR = 'error',
}

export interface VenusAddresses {
  comptroller: Address;
  oracle?: Address;
}

export interface DexAddresses {
  pancakeswapRouter: Address;
  pancakeswapV3Factory?: Address;
}

export interface BotConfig {
  rpcUrl: string;
  chainId: number;
  privateKey: string;
  minProfitUsd: number;
  minPositionSizeUsd: number;
  maxPositionSizeUsd: number;
  gasPriceMultiplier: number;
  maxGasPriceGwei: number;
  useFlashLoans: boolean;
  flashLoanFeeBps: number;
  collateralStrategy: CollateralStrategy;
  slippageTolerance: number;
  minSwapAmountUsd: number;
  maxPriceImpact: number;
  preferredStablecoin?: Address;
  pollingIntervalMs: number;
  minHealthFactor: number;
  logLevel: LogLevel;
  logToFile: boolean;
  venus: VenusAddresses;
  dex: DexAddresses;
  flashLiquidatorContract?: Address;
  healthyPollsBeforeDrop?: number;
  tokenBlacklist?: Address[];
  tokenWhitelist?: Address[];
  maxDailyLossUsd?: number;
  emergencyStopFile?: string;
  dryRun?: boolean;
  execution?: ExecutionConfig;
  statsLoggingIntervalMs?: number;
}

export interface AccountLiquidity {
  error: bigint;
  liquidity: bigint;
  shortfall: bigint;
}

export interface AccountSnapshot {
  error: bigint;
  vTokenBalance: bigint;
  borrowBalance: bigint;
  exchangeRate: bigint;
}

export interface VTokenMetadata {
  address: Address;
  symbol: string;
  decimals: number;
  underlyingAddress?: Address;
}

export interface TokenPositionDetail {
  vToken: Address;
  underlying?: Address;
  amount: bigint;
  valueUsd: number;
  decimals: number;
}

export interface VenusPosition {
  borrower: Address;
  healthFactor: number;
  collateralValueUsd: number;
  debtValueUsd: number;
  collateralTokens: Address[];
  borrowTokens: Address[];
  collateralDetails?: TokenPositionDetail[];
  borrowDetails?: TokenPositionDetail[];
  accountLiquidity: AccountLiquidity;
}

export type MonitoringEventType = 'Borrow' | 'RepayBorrow' | 'Mint' | 'Redeem' | 'LiquidateBorrow';

export interface MonitoringEvent {
  type: MonitoringEventType;
  vToken: Address;
  account: Address;
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
}

export interface LiquidatablePosition extends VenusPosition {
  repayToken: Address;
  repayAmount: bigint;
  seizeToken: Address;
  repayTokenDecimals?: number;
  repayTokenPriceUsd?: number;
  estimatedProfitUsd: number;
  lastUpdated: number;
}

export interface MonitoringStats {
  totalAccountsTracked: number;
  liquidatablePositions: number;
  lastPollTimestamp: number;
  eventsProcessed: number;
  averageHealthFactor: number;
}

export interface PositionTrackerStats {
  totalAccountsTracked: number;
  liquidatablePositions: number;
  averageHealthFactor: number;
}

// TODO: Define LiquidationOpportunity structure in Phase 3
export interface LiquidationOpportunity {
  borrower: Address;
  repayToken: Address;
  seizeToken: Address;
  expectedProfitUsd: number;
  mode: LiquidationMode;
}

// TODO: Define LiquidationResult structure in Phase 4
export interface LiquidationResult {
  success: boolean;
  txHash?: string;
  profitUsd?: number;
  gasUsd?: number;
  error?: string;
  mode?: LiquidationMode;
  repayAmount?: bigint;
  seizeAmount?: bigint;
  repayToken?: Address;
  seizeToken?: Address;
  gasUsed?: bigint;
  gasPriceGwei?: number;
  liquidationBonus?: number;
  flashLoanFee?: number;
  timestamp?: number;
  swapResult?: SwapResult;
  details?: Record<string, unknown>;
}

// TODO: Define SwapParams for DEX interactions in Phase 4
export interface SwapParams {
  path: Address[];
  amountIn: BigNumberish;
  amountOutMin: BigNumberish;
  fee: number;
  deadline: number;
  recipient: Address;
  sqrtPriceLimitX96?: bigint;
}

export interface TokenConfig {
  address: Address;
  symbol: string;
  decimals: number;
  isStablecoin: boolean;
  autoSell: boolean;
  preferredSwapPath?: Address[];
}

export type TokenConfigMap = Map<LowercaseAddress, TokenConfig>;

export interface SwapResult {
  success: boolean;
  txHash?: string;
  amountIn: bigint;
  amountOut?: bigint;
  tokenIn: Address;
  tokenOut: Address;
  gasUsed?: bigint;
  priceImpact?: number;
  error?: string;
}

export interface PriceImpactCheck {
  expectedAmountOut: bigint;
  actualAmountOut: bigint;
  /**
   * Unitless fraction (0–1) representing oracle-vs-DEX USD value deviation; 0.03 = 3%.
   * This is not AMM pool slippage, but a guardrail against trades far from oracle value.
   */
  impactPercent: number;
  isAcceptable: boolean;
  maxAllowedImpact: number;
}

export interface CollateralSwapConfig {
  strategy: CollateralStrategy;
  targetStablecoins: Address[];
  tokenConfigs: TokenConfigMap;
  maxSlippage: number;
  maxPriceImpact: number;
  minSwapAmountUsd: number;
}

export interface GasEstimate {
  estimatedGas: bigint;
  gasPriceGwei: number;
  estimatedCostUsd: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface FlashLoanParams {
  poolAddress: Address;
  token: Address;
  amount: bigint;
  fee: number;
  calldata: string; // abi-encoded bytes
}

export interface ProfitabilityAnalysis {
  grossProfitUsd: number;
  gasCostUsd: number;
  flashLoanFeeUsd: number;
  netProfitUsd: number;
  profitMargin: number;
  isProfitable: boolean;
  recommendedMode: LiquidationMode;
}

export interface LiquidationExecutionParams {
  position: LiquidatablePosition;
  mode: LiquidationMode;
  gasEstimate: GasEstimate;
  flashLoanParams?: FlashLoanParams;
  maxSlippage: number;
}

export enum RiskCheckType {
  TOKEN_BLACKLIST = 'TOKEN_BLACKLIST',
  TOKEN_WHITELIST = 'TOKEN_WHITELIST',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  GAS_PRICE_SPIKE = 'GAS_PRICE_SPIKE',
  DAILY_LOSS_LIMIT = 'DAILY_LOSS_LIMIT',
  EMERGENCY_STOP = 'EMERGENCY_STOP',
  HEALTH_FACTOR_CHANGED = 'HEALTH_FACTOR_CHANGED',
  POSITION_SIZE_EXCEEDED = 'POSITION_SIZE_EXCEEDED',
}

export interface RiskCheckResult {
  passed: boolean;
  checkType: RiskCheckType;
  reason?: string;
  details?: any;
}

export interface RiskValidationResult {
  canProceed: boolean;
  failedChecks: RiskCheckResult[];
  warnings: RiskCheckResult[];
}

export interface DailyStats {
  date: string;
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  totalProfitUsd: number;
  totalLossUsd: number;
  netProfitUsd: number;
}

export interface EmergencyStopState {
  isActive: boolean;
  reason?: string;
  activatedAt?: number;
  activatedBy?: string;
}

export interface ExecutionConfig {
  intervalMs: number;
  maxRetries: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  successCooldownMs: number;
}

export interface RetryState {
  positionKey: PositionKey;
  borrower: LowercaseAddress;
  retryCount: number;
  nextRetryAt: number;
  lastError?: string;
}

export interface ExecutionStats {
  isRunning: boolean;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  retriedExecutions: number;
  skippedDueToEmergencyStop: number;
  skippedDueToCooldown: number;
  skippedDueToBackoff: number;
  positionsInRetry: number;
  positionsInCooldown: number;
  lastExecutionTimestamp: number;
  totalExecutionTimeMs: number;
  averageExecutionTimeMs: number;
}

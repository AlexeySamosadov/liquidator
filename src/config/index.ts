import dotenv from 'dotenv';
import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import {
  BotConfig,
  CollateralStrategy,
  DexAddresses,
  ExecutionConfig,
  LogLevel,
  MonitoringMode,
  VenusAddresses,
} from '../types';
import { COMMON_TOKENS } from './tokens';

dotenv.config();

const parseNumber = (name: string, value: string | undefined, defaultValue?: number): number => {
  if (value === undefined || value === '') {
    if (defaultValue === undefined) {
      throw new Error(`Missing required numeric env: ${name}`);
    }
    return defaultValue;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Env ${name} must be a valid number`);
  }
  return parsed;
};

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
};

const requiredString = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

const validatePrivateKey = (pk: string): void => {
  const hexRegex = /^[0-9a-fA-F]{64}$/;
  if (!hexRegex.test(pk)) {
    throw new Error('PRIVATE_KEY must be 64 hex characters without 0x prefix');
  }
};

const clampSlippage = (value: number): number => {
  if (value < 0 || value > 1) {
    throw new Error('SLIPPAGE_TOLERANCE must be between 0 and 1');
  }
  return value;
};

const validateGasMultiplier = (value: number): number => {
  if (value < 1) {
    throw new Error('GAS_PRICE_MULTIPLIER must be >= 1.0');
  }
  return value;
};

const venusAddresses: VenusAddresses = {
  comptroller: requiredString('VENUS_COMPTROLLER', process.env.VENUS_COMPTROLLER),
  oracle: process.env.VENUS_ORACLE,
};

const dexAddresses: DexAddresses = {
  pancakeswapRouter: requiredString('PANCAKESWAP_ROUTER', process.env.PANCAKESWAP_ROUTER),
  pancakeswapV3Factory: process.env.PANCAKESWAP_V3_FACTORY || '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
};

export const loadConfig = (): BotConfig => {
  const rpcUrl = requiredString('RPC_URL', process.env.RPC_URL);
  const chainId = parseNumber('CHAIN_ID', process.env.CHAIN_ID, 56);
  const privateKey = requiredString('PRIVATE_KEY', process.env.PRIVATE_KEY);
  validatePrivateKey(privateKey);

  const minProfitUsd = parseNumber('MIN_PROFIT_USD', process.env.MIN_PROFIT_USD);
  if (minProfitUsd <= 0) {
    throw new Error('MIN_PROFIT_USD must be greater than 0');
  }

  const minPositionSizeUsd = parseNumber('MIN_POSITION_SIZE_USD', process.env.MIN_POSITION_SIZE_USD, 50);
  if (minPositionSizeUsd <= 0) {
    throw new Error('MIN_POSITION_SIZE_USD must be greater than 0');
  }

  const historicalScanBlocks = parseNumber('HISTORICAL_SCAN_BLOCKS', process.env.HISTORICAL_SCAN_BLOCKS, 1000);
  if (historicalScanBlocks <= 0) {
    throw new Error('HISTORICAL_SCAN_BLOCKS must be greater than 0');
  }

  const historicalScanWindowBlocks = parseNumber('HISTORICAL_SCAN_WINDOW_BLOCKS', process.env.HISTORICAL_SCAN_WINDOW_BLOCKS, 200);
  if (historicalScanWindowBlocks <= 0) {
    throw new Error('HISTORICAL_SCAN_WINDOW_BLOCKS must be greater than 0');
  }

  const maxPositionSizeUsd = parseNumber('MAX_POSITION_SIZE_USD', process.env.MAX_POSITION_SIZE_USD, 1000);
  const gasPriceMultiplier = validateGasMultiplier(
    parseNumber('GAS_PRICE_MULTIPLIER', process.env.GAS_PRICE_MULTIPLIER, 1.0),
  );
  const maxGasPriceGwei = parseNumber('MAX_GAS_PRICE_GWEI', process.env.MAX_GAS_PRICE_GWEI, 20);
  const flashLoanFeeBps = parseNumber('FLASH_LOAN_FEE_BPS', process.env.FLASH_LOAN_FEE_BPS, 500);
  if (flashLoanFeeBps <= 0) {
    throw new Error('FLASH_LOAN_FEE_BPS must be greater than 0');
  }

  const useFlashLoans = parseBoolean(process.env.USE_FLASH_LOANS, false);
  const collateralStrategy = (process.env.COLLATERAL_STRATEGY as CollateralStrategy) ||
    CollateralStrategy.AUTO_SELL;
  const slippageTolerance = clampSlippage(
    parseNumber('SLIPPAGE_TOLERANCE', process.env.SLIPPAGE_TOLERANCE, 0.02),
  );
  const minSwapAmountUsd = parseNumber('MIN_SWAP_AMOUNT_USD', process.env.MIN_SWAP_AMOUNT_USD, 10);
  const maxPriceImpact = clampSlippage(
    parseNumber('MAX_PRICE_IMPACT', process.env.MAX_PRICE_IMPACT, 0.03),
  );
  const preferredStablecoin = process.env.PREFERRED_STABLECOIN || COMMON_TOKENS.USDT;

  const pollingIntervalMs = parseNumber('POLLING_INTERVAL_MS', process.env.POLLING_INTERVAL_MS, 120000);
  const pollingBatchSize = parseNumber('POLLING_BATCH_SIZE', process.env.POLLING_BATCH_SIZE, 5);
  if (pollingBatchSize < 0) {
    throw new Error('POLLING_BATCH_SIZE must be >= 0');
  }
  const minHealthFactor = parseNumber('MIN_HEALTH_FACTOR', process.env.MIN_HEALTH_FACTOR, 1.0);

  const executionIntervalMs = parseNumber('EXECUTION_INTERVAL_MS', process.env.EXECUTION_INTERVAL_MS, 30000);
  if (executionIntervalMs <= 0) {
    throw new Error('EXECUTION_INTERVAL_MS must be greater than 0');
  }

  const executionMaxRetries = parseNumber('EXECUTION_MAX_RETRIES', process.env.EXECUTION_MAX_RETRIES, 3);
  if (executionMaxRetries < 0) {
    throw new Error('EXECUTION_MAX_RETRIES must be >= 0');
  }

  const executionBaseRetryDelayMs = parseNumber('EXECUTION_BASE_RETRY_DELAY_MS', process.env.EXECUTION_BASE_RETRY_DELAY_MS, 60000);
  if (executionBaseRetryDelayMs <= 0) {
    throw new Error('EXECUTION_BASE_RETRY_DELAY_MS must be greater than 0');
  }

  const executionMaxRetryDelayMs = parseNumber('EXECUTION_MAX_RETRY_DELAY_MS', process.env.EXECUTION_MAX_RETRY_DELAY_MS, 600000);
  if (executionMaxRetryDelayMs <= 0) {
    throw new Error('EXECUTION_MAX_RETRY_DELAY_MS must be greater than 0');
  }
  if (executionMaxRetryDelayMs < executionBaseRetryDelayMs) {
    throw new Error('EXECUTION_MAX_RETRY_DELAY_MS must be >= EXECUTION_BASE_RETRY_DELAY_MS');
  }

  const executionSuccessCooldownMs = parseNumber('EXECUTION_SUCCESS_COOLDOWN_MS', process.env.EXECUTION_SUCCESS_COOLDOWN_MS, 300000);
  if (executionSuccessCooldownMs < 0) {
    throw new Error('EXECUTION_SUCCESS_COOLDOWN_MS must be >= 0');
  }

  const tokenBlacklist = process.env.TOKEN_BLACKLIST?.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) || [];
  const tokenWhitelist = process.env.TOKEN_WHITELIST?.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) || [];
  const maxDailyLossUsd = parseNumber('MAX_DAILY_LOSS_USD', process.env.MAX_DAILY_LOSS_USD, 50);
  const emergencyStopFile = process.env.EMERGENCY_STOP_FILE || './emergency_stop.flag';
  const dryRun = parseBoolean(process.env.DRY_RUN, false);
  const statsLoggingIntervalMs = parseNumber('STATS_LOGGING_INTERVAL_MS', process.env.STATS_LOGGING_INTERVAL_MS, 60000);
  if (statsLoggingIntervalMs <= 0) {
    throw new Error('STATS_LOGGING_INTERVAL_MS must be greater than 0');
  }

  const overlap = tokenWhitelist.filter((t) => tokenBlacklist.includes(t));
  if (overlap.length > 0) {
    throw new Error(`TOKEN_WHITELIST and TOKEN_BLACKLIST overlap: ${overlap.join(', ')}`);
  }

  const logLevel = ((process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel) || LogLevel.INFO;
  const logToFile = parseBoolean(process.env.LOG_TO_FILE, true);
  const flashLiquidatorContract = process.env.FLASH_LIQUIDATOR_CONTRACT;
  const enableHistoricalScan = parseBoolean(process.env.ENABLE_HISTORICAL_SCAN, true);

  const monitoringMode = (process.env.MONITORING_MODE as MonitoringMode) || MonitoringMode.ENABLED;

  // Scan configuration parameters
  const scanIntervalMs = parseNumber('SCAN_INTERVAL_MS', process.env.SCAN_INTERVAL_MS, 120000);
  const scanBatchSize = parseNumber('SCAN_BATCH_SIZE', process.env.SCAN_BATCH_SIZE, 20);
  const scanWindowBlocks = parseNumber('SCAN_WINDOW_BLOCKS', process.env.SCAN_WINDOW_BLOCKS, 1000);
  const rpcDelayMs = parseNumber('RPC_DELAY_MS', process.env.RPC_DELAY_MS, 50);
  const maxNodeRealBlocks = parseNumber('MAX_NODE_REAL_BLOCKS', process.env.MAX_NODE_REAL_BLOCKS, 45000);

  const executionConfig: ExecutionConfig = {
    intervalMs: executionIntervalMs,
    maxRetries: executionMaxRetries,
    baseRetryDelayMs: executionBaseRetryDelayMs,
    maxRetryDelayMs: executionMaxRetryDelayMs,
    successCooldownMs: executionSuccessCooldownMs,
  };

  return {
    rpcUrl,
    chainId,
    privateKey,
    minProfitUsd,
    minPositionSizeUsd,
    maxPositionSizeUsd,
    gasPriceMultiplier,
    maxGasPriceGwei,
    flashLoanFeeBps,
    useFlashLoans,
    collateralStrategy,
    slippageTolerance,
    minSwapAmountUsd,
    maxPriceImpact,
    preferredStablecoin,
    pollingIntervalMs,
    pollingBatchSize,
    minHealthFactor,
    logLevel,
    logToFile,
    venus: venusAddresses,
    dex: dexAddresses,
    flashLiquidatorContract,
    enableHistoricalScan,
    monitoringMode,
    tokenBlacklist,
    tokenWhitelist,
    maxDailyLossUsd,
    emergencyStopFile,
    dryRun,
    statsLoggingIntervalMs,
    historicalScanBlocks,
    historicalScanWindowBlocks,
    scanIntervalMs,
    scanBatchSize,
    scanWindowBlocks,
    rpcDelayMs,
    maxNodeRealBlocks,
    execution: executionConfig,
  };
};

export const VENUS_ADDRESSES = venusAddresses;
export const DEX_ADDRESSES = dexAddresses;

/**
 * Create provider from RPC URL
 * Automatically detects and uses WebSocket for wss:// URLs
 * Falls back to JSON-RPC for http(s):// URLs
 */
export const createProvider = async (rpcUrl: string): Promise<JsonRpcProvider | WebSocketProvider> => {
  const { JsonRpcProvider: JRP, WebSocketProvider: WSP } = await import('ethers');

  if (rpcUrl.startsWith('wss://') || rpcUrl.startsWith('ws://')) {
    const wsProvider = new WSP(rpcUrl);
    // Test connection
    await wsProvider.getNetwork();
    return wsProvider;
  }

  return new JRP(rpcUrl);
};

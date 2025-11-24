import { parseUnits } from 'ethers';
import { COMMON_TOKENS, PANCAKE_FEE_TIERS } from '../../src/config/tokens';
import { Address } from '../../src/types';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const TEST_TOKENS = {
  WBNB: COMMON_TOKENS.WBNB,
  USDT: COMMON_TOKENS.USDT,
  BUSD: COMMON_TOKENS.BUSD,
  BTCB: COMMON_TOKENS.BTCB,
  ETH: COMMON_TOKENS.ETH,
  USDC: COMMON_TOKENS.USDC,
};

export const TEST_VTOKENS = {
  vWBNB: '0x1111111111111111111111111111111111111111',
  vUSDT: '0x2222222222222222222222222222222222222222',
  vBUSD: '0x3333333333333333333333333333333333333333',
  vBTCB: '0x4444444444444444444444444444444444444444',
  vETH: '0x5555555555555555555555555555555555555555',
  vUSDC: '0x6666666666666666666666666666666666666666',
};

export const TEST_ADDRESSES = {
  comptroller: '0xc0mptR0111111111111111111111111111111111',
  oracle: '0x0rAClE11111111111111111111111111111111111',
  liquidator: '0x1iqU1dAt01111111111111111111111111111111',
  router: '0xR0uTeR1111111111111111111111111111111111',
  factory: '0xFac70ry111111111111111111111111111111111',
  poolLow: '0xP001111111111111111111111111111111111111',
  poolMed: '0xP002222222222222222222222222222222222222',
  poolHigh: '0xP003333333333333333333333333333333333333',
};

export const TEST_ACCOUNTS: Address[] = [
  '0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA',
  '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
  '0xcCcCCcCcCcCCcCCCCCCcCcCcCcCCcCcCcccccccC',
];

export const DEFAULT_MAX_FEE_PER_GAS = parseUnits('5', 'gwei');
export const DEFAULT_PRIORITY_FEE = parseUnits('1', 'gwei');
export const HIGH_GAS_PRICE = parseUnits('50', 'gwei');
export const FLASH_LOAN_FEE_BPS = 9;
export const GAS_MULTIPLIER_DEFAULT = 1.1;
export const GAS_MULTIPLIER_HIGH = 1.5;
export const GAS_MULTIPLIER_BASE = 1.0;
export const MAX_GAS_CAP_GWEI = 20;
export const BNB_PRICE_USD = 300;
export const USDT_DECIMALS = 6;
export const WBTC_DECIMALS = 8;
export const WBNB_DECIMALS = 18;
export const STANDARD_TOKEN_DECIMALS = 18;

export const DEFAULT_HEALTH_FACTOR = 1.5;
export const LIQUIDATION_THRESHOLD = 1.0;
export const MIN_HEALTH_FACTOR = 1.05;
export const DEFAULT_LIQUIDATION_INCENTIVE = parseUnits('1.08', 18);
export const DEFAULT_EXCHANGE_RATE = parseUnits('0.02', 18);
export const DEFAULT_GAS_PRICE = parseUnits('5', 'gwei');
export const DEFAULT_GAS_LIMIT = 500000n;

export const DEFAULT_TOKEN_PRICES: Map<Address, number> = new Map<Address, number>([
  [TEST_TOKENS.WBNB, 300],
  [TEST_TOKENS.USDT, 1],
  [TEST_TOKENS.BTCB, 40000],
  [TEST_TOKENS.ETH, 2000],
  [TEST_TOKENS.BUSD, 1],
  [TEST_TOKENS.USDC, 1],
]);

export const DEFAULT_TOKEN_DECIMALS: Map<Address, number> = new Map<Address, number>([
  [TEST_TOKENS.WBNB, WBNB_DECIMALS],
  [TEST_TOKENS.USDT, USDT_DECIMALS],
  [TEST_TOKENS.BUSD, STANDARD_TOKEN_DECIMALS],
  [TEST_TOKENS.USDC, STANDARD_TOKEN_DECIMALS],
  [TEST_TOKENS.BTCB, WBTC_DECIMALS],
  [TEST_TOKENS.ETH, STANDARD_TOKEN_DECIMALS],
]);

export const SLIPPAGE_LOW = 0.005;
export const SLIPPAGE_MEDIUM = 0.01;
export const SLIPPAGE_HIGH = 0.05;
export const PRICE_IMPACT_LOW = 0.01;
export const PRICE_IMPACT_MEDIUM = 0.05;
export const PRICE_IMPACT_HIGH = 0.15;
export const PRICE_IMPACT_EXTREME = 0.5;
export const MAX_PRICE_IMPACT_DEFAULT = 0.1;

export const MIN_SWAP_AMOUNT_USD = 10;
export const SMALL_SWAP_USD = 50;
export const MEDIUM_SWAP_USD = 500;
export const LARGE_SWAP_USD = 5000;

export const SMALL_AMOUNT = parseUnits('100', 18);
export const MEDIUM_AMOUNT = parseUnits('1000', 18);
export const LARGE_AMOUNT = parseUnits('10000', 18);
export const DUST_AMOUNT = parseUnits('0.01', 18);

export const DIRECT_ROUTE_WBNB_USDT = [TEST_TOKENS.WBNB, TEST_TOKENS.USDT];
export const DIRECT_ROUTE_BTCB_WBNB = [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB];
export const MULTI_HOP_BTCB_USDT = [TEST_TOKENS.BTCB, TEST_TOKENS.WBNB, TEST_TOKENS.USDT];
export const MULTI_HOP_ETH_USDT = [TEST_TOKENS.ETH, TEST_TOKENS.WBNB, TEST_TOKENS.USDT];

export const FEE_TIER_LOW = PANCAKE_FEE_TIERS.LOW;
export const FEE_TIER_MEDIUM = PANCAKE_FEE_TIERS.MEDIUM;
export const FEE_TIER_HIGH = PANCAKE_FEE_TIERS.HIGH;

export const TEST_POOL_WBNB_USDT_LOW = '0xP00L111111111111111111111111111111111111';
export const TEST_POOL_WBNB_USDT_MED = '0xP00L222222222222222222222222222222222222';
export const TEST_POOL_BTCB_WBNB_MED = '0xP00L333333333333333333333333333333333333';

export const SWAP_AMOUNT_WBNB = parseUnits('10', WBNB_DECIMALS);
export const SWAP_AMOUNT_USDT = parseUnits('1000', USDT_DECIMALS);
export const SWAP_AMOUNT_BTCB = parseUnits('0.1', WBTC_DECIMALS);
export const DUST_SWAP_AMOUNT = parseUnits('0.001', 18);

export const EXPECTED_OUT_WBNB_TO_USDT = parseUnits('2900', USDT_DECIMALS);
export const EXPECTED_OUT_BTCB_TO_USDT = parseUnits('38000', USDT_DECIMALS);

export const NOW = Math.floor(Date.now() / 1000);
export const ONE_HOUR = 3600;
export const ONE_DAY = 86400;
export const ONE_WEEK = 604800;

export const TEST_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

export const FEE_LOW = PANCAKE_FEE_TIERS.LOW;
export const FEE_MEDIUM = PANCAKE_FEE_TIERS.MEDIUM;
export const FEE_HIGH = PANCAKE_FEE_TIERS.HIGH;

export const generateTestTxHash = (counter: number = Date.now()): string =>
  `0x${counter.toString(16).padStart(64, '0')}`;

// Health Factor constants
export const HEALTHY_HF = 1.5;
export const MARGINAL_HF = 1.05;
export const LIQUIDATABLE_HF = 0.95;
export const CRITICAL_HF = 0.5;
export const ZERO_HF = 0;
export const INFINITY_HF = Number.POSITIVE_INFINITY;
export const NAN_HF = Number.NaN;

// Liquidity constants
export const HEALTHY_LIQUIDITY = parseUnits('10000', 18);
export const ZERO_LIQUIDITY = 0n;
export const SMALL_SHORTFALL = parseUnits('100', 18);
export const LARGE_SHORTFALL = parseUnits('5000', 18);

// Position size constants
export const MIN_POSITION_SIZE_USD = 100;
export const SMALL_POSITION_USD = 500;
export const MEDIUM_POSITION_USD = 5_000;
export const LARGE_POSITION_USD = 50_000;
export const HUGE_POSITION_USD = 500_000;

// Monitoring intervals
export const FAST_POLLING_MS = 100;
export const NORMAL_POLLING_MS = 5_000;
export const SLOW_POLLING_MS = 30_000;

// Liquidation incentive
export const DEFAULT_LIQUIDATION_INCENTIVE_MANTISSA = parseUnits('1.08', 18);
export const HIGH_LIQUIDATION_INCENTIVE_MANTISSA = parseUnits('1.15', 18);

// Profit estimates
export const SMALL_PROFIT_USD = 10;
export const MEDIUM_PROFIT_USD = 100;
export const LARGE_PROFIT_USD = 1_000;
export const NEGATIVE_PROFIT_USD = -50;

// Healthy polls threshold
export const DEFAULT_HEALTHY_POLLS_THRESHOLD = 3;
export const FAST_DROP_THRESHOLD = 1;
export const SLOW_DROP_THRESHOLD = 10;

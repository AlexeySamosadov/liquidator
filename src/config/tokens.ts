import {
  Address,
  LowercaseAddress,
  TokenConfig,
  TokenConfigMap,
} from '../types';

export const COMMON_TOKENS: Record<string, Address> = {
  WBNB: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  BUSD: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
  BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};

export const STABLECOIN_ADDRESSES: Address[] = [
  COMMON_TOKENS.USDT,
  COMMON_TOKENS.BUSD,
  COMMON_TOKENS.USDC,
];

export const PANCAKE_FEE_TIERS = {
  LOW: 500,
  MEDIUM: 2500,
  HIGH: 10000,
};

const DEFAULT_TOKEN_CONFIG_ENTRIES: [Address, TokenConfig][] = [
  [COMMON_TOKENS.USDT, {
    address: COMMON_TOKENS.USDT,
    symbol: 'USDT',
    decimals: 18,
    isStablecoin: true,
    autoSell: false,
  }],
  [COMMON_TOKENS.BUSD, {
    address: COMMON_TOKENS.BUSD,
    symbol: 'BUSD',
    decimals: 18,
    isStablecoin: true,
    autoSell: false,
  }],
  [COMMON_TOKENS.USDC, {
    address: COMMON_TOKENS.USDC,
    symbol: 'USDC',
    decimals: 18,
    isStablecoin: true,
    autoSell: false,
  }],
  [COMMON_TOKENS.WBNB, {
    address: COMMON_TOKENS.WBNB,
    symbol: 'WBNB',
    decimals: 18,
    isStablecoin: false,
    autoSell: true,
    preferredSwapPath: [COMMON_TOKENS.WBNB, COMMON_TOKENS.USDT],
  }],
  [COMMON_TOKENS.BTCB, {
    address: COMMON_TOKENS.BTCB,
    symbol: 'BTCB',
    decimals: 18,
    isStablecoin: false,
    autoSell: true,
    preferredSwapPath: [COMMON_TOKENS.BTCB, COMMON_TOKENS.WBNB, COMMON_TOKENS.USDT],
  }],
  [COMMON_TOKENS.ETH, {
    address: COMMON_TOKENS.ETH,
    symbol: 'ETH',
    decimals: 18,
    isStablecoin: false,
    autoSell: true,
    preferredSwapPath: [COMMON_TOKENS.ETH, COMMON_TOKENS.WBNB, COMMON_TOKENS.USDT],
  }],
];

export const DEFAULT_TOKEN_CONFIGS: TokenConfigMap = new Map(
  DEFAULT_TOKEN_CONFIG_ENTRIES.map(([addr, config]) => [
    addr.toLowerCase() as LowercaseAddress,
    config,
  ]),
);

export const isStablecoin = (address: Address): boolean => STABLECOIN_ADDRESSES
  .map((a) => a.toLowerCase())
  .includes(address.toLowerCase());

export const getTokenConfig = (address: Address): TokenConfig | undefined => DEFAULT_TOKEN_CONFIGS
  .get(address.toLowerCase() as LowercaseAddress);

export const getPreferredSwapPath = (tokenIn: Address, tokenOut: Address): Address[] => {
  const config = DEFAULT_TOKEN_CONFIGS.get(tokenIn.toLowerCase() as LowercaseAddress);
  if (config?.preferredSwapPath) {
    return config.preferredSwapPath;
  }
  return [tokenIn, tokenOut];
};

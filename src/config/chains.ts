/**
 * Pre-defined chain configurations for multi-chain support
 */

import { Chain, ChainConfig, Protocol, CHAIN_IDS } from '../types';

// GMX V2 Arbitrum Contract Addresses
export const GMX_ARBITRUM_ADDRESSES = {
  marketFactory: '0xf5F30B10141E1F63FC11eD772931A8294a591996',
  exchangeRouter: '0x7c68c7866a64fa2160f78eeae12217ffbf871fa8',
  depositVault: '0xF89e77e8Dc11691C9e8757e84aaFbCD8A67d7A55',
  reader: '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E',  // GMX V2 SyntheticsReader
  dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',  // DataStore for market data
};

// Uniswap V3 on Arbitrum
export const UNISWAP_ARBITRUM_ADDRESSES = {
  router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',  // SwapRouter
  factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
};

// Venus Protocol on BSC (legacy)
export const VENUS_BSC_ADDRESSES = {
  comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
  oracle: '0x6592b5DE802159F3E74B2486b091D11a8256ab8A',
};

// PancakeSwap on BSC
export const PANCAKESWAP_BSC_ADDRESSES = {
  router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',  // V3
};

/**
 * Pre-configured chain configurations with NodeReal endpoints
 */
export const PREDEFINED_CHAINS: Record<string, ChainConfig> = {
  'bsc-venus': {
    chain: Chain.BSC,
    rpcUrl: 'https://bsc-mainnet.nodereal.io/v1/YOUR_API_KEY',
    wssUrl: 'wss://bsc-mainnet.nodereal.io/ws/v1/YOUR_API_KEY',
    chainId: CHAIN_IDS[Chain.BSC],
    protocol: Protocol.VENUS,
    venus: VENUS_BSC_ADDRESSES,
    dex: {
      pancakeswapRouter: PANCAKESWAP_BSC_ADDRESSES.router,
      pancakeswapV3Factory: PANCAKESWAP_BSC_ADDRESSES.factory,
    },
  },

  'arbitrum-gmx': {
    chain: Chain.ARBITRUM,
    rpcUrl: 'https://open-platform.nodereal.io/YOUR_API_KEY/arbitrum-nitro/',
    wssUrl: 'wss://open-platform.nodereal.io/ws/YOUR_API_KEY/arbitrum-nitro/',
    // bloXroute private RPC for MEV protection
    privateRpcUrl: 'https://arbitrum.blxrbdn.com',
    chainId: CHAIN_IDS[Chain.ARBITRUM],
    protocol: Protocol.GMX,
    gmx: GMX_ARBITRUM_ADDRESSES,
    dex: {
      pancakeswapRouter: UNISWAP_ARBITRUM_ADDRESSES.router,  // Using Uniswap on Arbitrum
      pancakeswapV3Factory: UNISWAP_ARBITRUM_ADDRESSES.factory,
    },
  },

  'avalanche-gmx': {
    chain: Chain.AVALANCHE,
    rpcUrl: 'https://open-platform.nodereal.io/YOUR_API_KEY/avalanche-c/ext/bc/C/rpc/',
    wssUrl: 'wss://open-platform.nodereal.io/ws/YOUR_API_KEY/avalanche-c/ext/bc/C/ws/',
    chainId: CHAIN_IDS[Chain.AVALANCHE],
    protocol: Protocol.GMX,
    gmx: {
      marketFactory: '0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6',  // GMX V2 Avalanche (placeholder)
      exchangeRouter: '0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6',
      depositVault: '0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6',
    },
    dex: {
      pancakeswapRouter: '0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106',  // TraderJoe Router on Avalanche
    },
  },
};

/**
 * Get chain configuration by name
 */
export function getChainConfig(name: string): ChainConfig | undefined {
  return PREDEFINED_CHAINS[name];
}

/**
 * Get all available chain names
 */
export function getAvailableChains(): string[] {
  return Object.keys(PREDEFINED_CHAINS);
}

/**
 * Replace API key placeholder in chain config URLs
 */
export function configureChainWithApiKey(config: ChainConfig, apiKey: string): ChainConfig {
  return {
    ...config,
    rpcUrl: config.rpcUrl.replace('YOUR_API_KEY', apiKey),
    wssUrl: config.wssUrl?.replace('YOUR_API_KEY', apiKey),
  };
}

/**
 * Get configured chain with NodeReal API key
 */
export function getConfiguredChain(name: string, apiKey: string): ChainConfig | undefined {
  const config = PREDEFINED_CHAINS[name];
  if (!config) return undefined;
  return configureChainWithApiKey(config, apiKey);
}

/**
 * RPC Providers for different chains
 */
export const RPC_PROVIDERS = {
  [Chain.BSC]: [
    'https://bsc-dataseed.binance.org/',
    'https://bsc-dataseed1.defibit.io/',
    'https://bsc-dataseed1.ninicoin.io/',
  ],
  [Chain.ARBITRUM]: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.llamarpc.com',
    'https://arbitrum-one.publicnode.com',
  ],
  [Chain.AVALANCHE]: [
    'https://api.avax.network/ext/bc/C/rpc',
    'https://avalanche.publicnode.com',
    'https://avalanche-c-chain.publicnode.com',
  ],
};

/**
 * WebSocket providers for real-time events
 */
export const WSS_PROVIDERS = {
  [Chain.BSC]: [
    'wss://bsc-ws-node.nariox.org:443',
  ],
  [Chain.ARBITRUM]: [
    'wss://arb1.arbitrum.io/ws',
  ],
  [Chain.AVALANCHE]: [
    'wss://api.avax.network/ext/bc/C/ws',
  ],
};

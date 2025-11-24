import { Address } from '../types';
import { COMMON_TOKENS } from './tokens';

// Mapping from underlying token address to corresponding Venus vToken.
// Addresses are stored in lowercase for case-insensitive lookups.
const VTOKEN_BY_UNDERLYING: Record<string, Address> = {
  [COMMON_TOKENS.WBNB.toLowerCase()]: '0xa07c5b74c9b40447a954e1466938b865b6bbea36', // vBNB
  [COMMON_TOKENS.USDT.toLowerCase()]: '0xfd5840cd36d94d7229439859c0112a4185bc0255', // vUSDT
  [COMMON_TOKENS.BUSD.toLowerCase()]: '0x95c7822b3d6e262426483d42cfaf53685a67ab9d', // vBUSD
  [COMMON_TOKENS.USDC.toLowerCase()]: '0xeca88125a5adbe82614ffc12d0db554e2e2867c8', // vUSDC
  [COMMON_TOKENS.BTCB.toLowerCase()]: '0x882c173bc7ff3b7786ca16dfed3dfffb9ee7847b', // vBTC
  [COMMON_TOKENS.ETH.toLowerCase()]: '0xf508fcd89b8bd15579dc79a6827cb4686a3592c8', // vETH
};

export const getVTokenForUnderlying = (underlying: Address): Address | undefined => (
  VTOKEN_BY_UNDERLYING[underlying.toLowerCase()]
);

export default VTOKEN_BY_UNDERLYING;

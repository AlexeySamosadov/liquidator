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

  // Additional popular Venus markets to reduce RPC calls
  '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe': '0xb248a295732e0225acd3337607cc01068e3b9c10', // XRP -> vXRP
  '0x3ee2200efb3400fabb9aacf31297cbdd1d435d47': '0x9E721ea2Cf6b11c5C1a17d7Ba896F6F4a1Ad6E99', // ADA -> vADA
  '0xba2ae424d960c26247dd6c32edc70b295c744c43': '0x217413d539Ae8352e6d2133216315ae2E58A5f3f', // DOGE -> vDOGE
  '0x4338665cbb7b2485a8855a139b75d5e34ab0db94': '0x1C47383b3eC153F07A17AC7fE85C23eE2390d425', // LTC -> vLTC
  '0xcc42724c6683b7e57334c4e856f4c9965ed682bd': '0xf4c8e32eadec4bfe8e9d8ff5fb839281e9f55259', // LINK -> vLINK
  '0xbf5140a22578168fd562dccf235e5d43a02ce9b1': '0x141f15a0c1dcd5910f586ae5eefcf38368b4c2d2', // UNI -> vUNI
  '0x3d4350cd54aef9f9b2c29401e7fa954b64b19dbd': '0x151f1a376e4b7a6c4cae0de3182c0946d34d3271', // ATOM -> vATOM
  '0x7083609fce4d1d8dc0c979aab8c869ea2c873402': '0xA0c830dC5ec637Cf81906Faf25C5E359C3C167e6', // DOT -> vDOT
  '0xce7de646e7208a4ef112cb6edeb8ce24bc4553cf': '0xab39de1d8f4f61c3ab074cf6b8f9bb97de89f35f', // APE -> vAPE
  '0x47bead2563d9f52bf740ffa75b88b28b83d25fab': '0x37a5f2f92862023b1b39d5b710ca8d5aecd614b6', // SXP -> vSXP
  '0xcf6bb5389c92bdda8a3747ddb454cb7a64626c96': '0x744692813ad95b3bfdc5cd4ca424c4e35691924d', // XVS -> vXVS
  '0x85eac5ac2f758618dfa09bdbe0cf174e7d574d5b': '0x836beb2ccb5f2aa07e4f7c2b2ac38b8c5422c3b2', // TRX -> vTRX
  '0x0d8ce2a99bb6e3b77db580ed3b2740c410df362d': '0x1610bc33319e9398de5f57b33a5b184c806ad215', // FIL -> vFIL
  '0x14016e85a25aeb13065688cafb43044c2ef86784': '0x08ceb3f4a7ed3500ca0982bcd0fc7816688084c3', // TUSD -> vTUSD
  '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': '0x334b3ecb4dcaa2d6d6cc14ed3a0d44ab3d82c9c6', // DAI -> vDAI
};

// Canonical vUSDT vToken address for liquidation incentive calculations
export const VUSDT_VTOKEN_ADDRESS = '0xfd5840cd36d94d7229439859c0112a4185bc0255' as Address;

export const getVTokenForUnderlying = (underlying: Address): Address | undefined => (
  VTOKEN_BY_UNDERLYING[underlying.toLowerCase()]
);

export default VTOKEN_BY_UNDERLYING;

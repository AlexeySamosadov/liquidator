export interface ExactInputSingleParams {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint;
}

export interface ExactInputParams {
  path: string;
  recipient: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
}

/**
 * Minimal ABI for PancakeSwap V3 SmartRouter (Uniswap V3 fork).
 * Fee tiers: 500 = 0.05%, 2500 = 0.25%, 10000 = 1%.
 * Set sqrtPriceLimitX96 to 0 to disable price limit checks.
 */
export const PANCAKE_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
];

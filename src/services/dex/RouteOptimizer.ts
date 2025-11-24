import { Contract, JsonRpcProvider, solidityPacked } from 'ethers';
import { Address } from '../../types';
import { PANCAKE_V3_POOL_ABI } from '../../contracts/abis/PancakeV3Pool.abi';
import { COMMON_TOKENS, PANCAKE_FEE_TIERS } from '../../config/tokens';
import { logger } from '../../utils/logger';
import { PANCAKE_V3_ROUTER_ABI } from '../../contracts/abis/PancakeSwapV3Router.abi';
import SwapExecutor from './SwapExecutor';

const FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'];

class RouteOptimizer {
  private factory: Contract;

  private readonly router?: Contract;

  private readonly swapExecutor?: SwapExecutor;

  private poolCache: Map<string, string | null> = new Map();

  constructor(
    private readonly provider: JsonRpcProvider,
    factoryAddress: Address,
    routerAddress?: Address,
    swapExecutor?: SwapExecutor,
  ) {
    this.factory = new Contract(factoryAddress, FACTORY_ABI, provider);
    this.router = routerAddress ? new Contract(routerAddress, PANCAKE_V3_ROUTER_ABI, provider) : undefined;
    this.swapExecutor = swapExecutor;
  }

  async findBestRoute(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<{ path: Address[]; fees: number[]; expectedOut: bigint }> {
    const feeTiers = [PANCAKE_FEE_TIERS.LOW, PANCAKE_FEE_TIERS.MEDIUM, PANCAKE_FEE_TIERS.HIGH];

    let bestRoute = { path: [] as Address[], fees: [] as number[], expectedOut: 0n };

    logger.debug('Finding best route', { tokenIn, tokenOut, amountIn: amountIn.toString() });

    // Direct pool
    for (const fee of feeTiers) {
      const pool = await this.getPool(tokenIn, tokenOut, fee);
      if (pool) {
        const expectedOut = await this.estimateMultiHopOutput([tokenIn, tokenOut], [fee], amountIn);
        if (expectedOut > bestRoute.expectedOut) {
          bestRoute = { path: [tokenIn, tokenOut], fees: [fee], expectedOut };
        }
      }
    }

    // Two-hop via WBNB or USDT
    const intermediaries = [COMMON_TOKENS.WBNB, COMMON_TOKENS.USDT, COMMON_TOKENS.BUSD];
    for (const intermediary of intermediaries) {
      if (intermediary.toLowerCase() === tokenIn.toLowerCase() || intermediary.toLowerCase() === tokenOut.toLowerCase()) {
        continue;
      }

      const firstFee = await this.selectBestFee(tokenIn, intermediary);
      const secondFee = await this.selectBestFee(intermediary, tokenOut);
      if (!firstFee || !secondFee) continue;

      const firstPool = await this.getPool(tokenIn, intermediary, firstFee);
      const secondPool = await this.getPool(intermediary, tokenOut, secondFee);
      if (firstPool && secondPool) {
        const expectedOut = await this.estimateMultiHopOutput([tokenIn, intermediary, tokenOut], [firstFee, secondFee], amountIn);
        if (expectedOut > bestRoute.expectedOut) {
          bestRoute = { path: [tokenIn, intermediary, tokenOut], fees: [firstFee, secondFee], expectedOut };
        }
      }
    }

    return bestRoute;
  }

  async estimateMultiHopOutput(path: Address[], fees: number[], amountIn: bigint): Promise<bigint> {
    if (path.length < 2 || fees.length !== path.length - 1) {
      return 0n;
    }

    if (this.swapExecutor) {
      try {
        let currentAmount = amountIn;
        for (let i = 0; i < fees.length; i += 1) {
          const expected = await this.swapExecutor.estimateSwapOutput(path[i], path[i + 1], currentAmount, fees[i]);
          if (expected === 0n) {
            return 0n;
          }
          currentAmount = expected;
        }
        return currentAmount;
      } catch (error) {
        logger.debug('SwapExecutor-based output estimation failed', { path, fees, error: (error as Error).message });
      }
    }

    if (!this.router) {
      return 0n;
    }

    try {
      if (path.length === 2) {
        const params = {
          tokenIn: path[0],
          tokenOut: path[1],
          fee: fees[0],
          recipient: '0x0000000000000000000000000000000000000001',
          amountIn,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        };
        const expected: bigint = await (this.router as any).callStatic.exactInputSingle(params);
        return expected;
      }

      const encodedPath = this.encodePath(path, fees);
      const params = {
        path: encodedPath,
        recipient: '0x0000000000000000000000000000000000000001',
        amountIn,
        amountOutMinimum: 0n,
      };
      const expected: bigint = await (this.router as any).callStatic.exactInput(params);
      return expected;
    } catch (error) {
      logger.debug('Route output estimation failed', { path, fees, error: (error as Error).message });
      return 0n;
    }
  }

  private async getPool(tokenA: Address, tokenB: Address, fee: number): Promise<string | null> {
    const key = `${tokenA.toLowerCase()}-${tokenB.toLowerCase()}-${fee}`;
    if (this.poolCache.has(key)) {
      return this.poolCache.get(key) ?? null;
    }
    try {
      const pool: string = await this.factory.getPool(tokenA, tokenB, fee);
      if (pool && pool !== '0x0000000000000000000000000000000000000000') {
        this.poolCache.set(key, pool);
        return pool;
      }
      this.poolCache.set(key, null);
      return null;
    } catch (error) {
      logger.warn('Pool lookup failed', { tokenA, tokenB, fee, error: (error as Error).message });
      this.poolCache.set(key, null);
      return null;
    }
  }

  private async getPoolLiquidity(poolAddress: string): Promise<bigint> {
    try {
      const pool = new Contract(poolAddress, PANCAKE_V3_POOL_ABI, this.provider);
      const liquidity: bigint = await pool.liquidity();
      return liquidity;
    } catch (error) {
      logger.warn('Failed to fetch pool liquidity', { poolAddress, error: (error as Error).message });
      return 0n;
    }
  }

  private async selectBestFee(tokenA: Address, tokenB: Address): Promise<number | null> {
    const fees = [PANCAKE_FEE_TIERS.LOW, PANCAKE_FEE_TIERS.MEDIUM, PANCAKE_FEE_TIERS.HIGH];
    let bestFee: number | null = null;
    let bestLiquidity = 0n;

    for (const fee of fees) {
      const pool = await this.getPool(tokenA, tokenB, fee);
      if (!pool) continue;
      const liquidity = await this.getPoolLiquidity(pool);
      if (liquidity > bestLiquidity) {
        bestLiquidity = liquidity;
        bestFee = fee;
      }
    }

    return bestFee ?? PANCAKE_FEE_TIERS.MEDIUM;
  }

  private encodePath(tokens: Address[], fees: number[]): string {
    if (tokens.length !== fees.length + 1) {
      throw new Error('Invalid path/fee lengths for encoding');
    }

    const packed: string[] = [];
    for (let i = 0; i < tokens.length - 1; i += 1) {
      packed.push(solidityPacked(['address', 'uint24'], [tokens[i], fees[i]]));
    }
    packed.push(solidityPacked(['address'], [tokens[tokens.length - 1]]));
    return `0x${packed.map((p) => p.replace(/^0x/, '')).join('')}`;
  }
}

export default RouteOptimizer;

import { BigNumberish, Contract, Interface, Log, Wallet, solidityPacked } from 'ethers';
import { ExactInputParams, ExactInputSingleParams } from '../../contracts/abis/PancakeSwapV3Router.abi';
import {
  Address,
  BotConfig,
  GasEstimate,
  SwapParams,
  SwapResult,
} from '../../types';
import { logger } from '../../utils/logger';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a402b7b8ab';

class SwapExecutor {
  private router: any;

  private readonly erc20Interface: Interface;

  constructor(
    router: any,
    private readonly signer: Wallet,
    private readonly config: BotConfig,
  ) {
    this.router = router.connect(signer);
    this.erc20Interface = new Interface(ERC20_ABI);
  }

  async executeSingleHopSwap(params: SwapParams, gasParams: Pick<GasEstimate, 'maxFeePerGas' | 'maxPriorityFeePerGas'>): Promise<SwapResult> {
    const [tokenIn, tokenOut] = params.path;
    const amountIn = BigInt(params.amountIn);

    try {
      await this.approveTokenIfNeeded(tokenIn, this.router.target as string, amountIn);

      const amountOutMinimum = await this.ensureMinAmountOutSingle(
        tokenIn,
        tokenOut,
        amountIn,
        params.fee,
        params.amountOutMin,
      );

      const swapParams: ExactInputSingleParams = {
        tokenIn,
        tokenOut,
        fee: params.fee,
        recipient: params.recipient,
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
      };

      const tx = await this.router.exactInputSingle(
        swapParams,
        {
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        },
      );
      const receipt = await tx.wait();
      const gasUsed = receipt?.gasUsed ? BigInt(receipt.gasUsed) : undefined;
      const amountOut = this.deriveAmountOutFromLogs(receipt?.logs, tokenOut, params.recipient);

      logger.info('Single-hop swap executed', { tokenIn, tokenOut, amountIn: amountIn.toString(), txHash: tx.hash });

      return {
        success: true,
        txHash: tx.hash,
        amountIn,
        amountOut,
        tokenIn,
        tokenOut,
        gasUsed,
      };
    } catch (error) {
      const message = (error as Error).message;
      logger.error('Single-hop swap failed', { error: message, tokenIn, tokenOut });
      return {
        success: false,
        error: message,
        amountIn,
        tokenIn,
        tokenOut,
      };
    }
  }

  async executeMultiHopSwap(
    path: Address[],
    fees: number[],
    amountIn: bigint,
    amountOutMin: bigint,
    gasParams: Pick<GasEstimate, 'maxFeePerGas' | 'maxPriorityFeePerGas'>,
    recipient: Address,
  ): Promise<SwapResult> {
    const tokenIn = path[0];
    const tokenOut = path[path.length - 1];

    try {
      await this.approveTokenIfNeeded(tokenIn, this.router.target as string, amountIn);
      const encodedPath = this.encodePath(path, fees);
      const minAmountOut = await this.ensureMinAmountOutMulti(path, fees, amountIn, amountOutMin);
      const swapParams: ExactInputParams = {
        path: encodedPath,
        recipient,
        amountIn,
        amountOutMinimum: minAmountOut,
      };

      const tx = await this.router.exactInput(
        swapParams,
        {
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        },
      );

      const receipt = await tx.wait();
      const gasUsed = receipt?.gasUsed ? BigInt(receipt.gasUsed) : undefined;
      const amountOut = this.deriveAmountOutFromLogs(receipt?.logs, tokenOut, recipient);

      logger.info('Multi-hop swap executed', {
        path,
        fees,
        amountIn: amountIn.toString(),
        txHash: tx.hash,
      });

      return {
        success: true,
        txHash: tx.hash,
        amountIn,
        amountOut,
        tokenIn,
        tokenOut,
        gasUsed,
      };
    } catch (error) {
      const message = (error as Error).message;
      logger.error('Multi-hop swap failed', { error: message, path });
      return {
        success: false,
        error: message,
        amountIn,
        tokenIn,
        tokenOut,
      };
    }
  }

  async estimateSwapOutput(tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number): Promise<bigint> {
    try {
      const params: ExactInputSingleParams = {
        tokenIn,
        tokenOut,
        fee,
        recipient: this.signer.address,
        amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      };
      const expected = await this.router.callStatic.exactInputSingle(params);
      return expected;
    } catch (error) {
      logger.warn('Swap output estimation failed', { error: (error as Error).message, tokenIn, tokenOut, fee });
      return 0n;
    }
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

  private async approveTokenIfNeeded(token: Address, spender: Address, amount: bigint): Promise<void> {
    const erc20 = new Contract(token, ERC20_ABI, this.signer);
    const allowance: bigint = await erc20.allowance(this.signer.address, spender);
    if (allowance >= amount) {
      return;
    }
    const tx = await erc20.approve(spender, amount);
    await tx.wait();
    logger.info('Approval submitted', { token, spender, amount: amount.toString(), txHash: tx.hash });
  }

  private async ensureMinAmountOutSingle(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    fee: number,
    providedMin?: BigNumberish,
  ): Promise<bigint> {
    const explicit = providedMin !== undefined ? BigInt(providedMin) : 0n;
    if (explicit > 0n) return explicit;

    try {
      const quote = await this.router.callStatic.exactInputSingle({
        tokenIn,
        tokenOut,
        fee,
        recipient: this.signer.address,
        amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      });

      const toleranceBps = Math.floor(this.config.slippageTolerance * 10_000);
      const minOut = (quote * BigInt(10_000 - toleranceBps)) / 10_000n;
      return minOut > 0n ? minOut : 0n;
    } catch (error) {
      logger.warn('Failed to derive minOut from quote, using provided fallback', {
        tokenIn,
        tokenOut,
        error: (error as Error).message,
      });
      return explicit;
    }
  }

  private async ensureMinAmountOutMulti(
    path: Address[],
    fees: number[],
    amountIn: bigint,
    providedMin: bigint,
  ): Promise<bigint> {
    if (providedMin && providedMin > 0n) {
      return providedMin;
    }

    try {
      const encodedPath = this.encodePath(path, fees);
      const quote = await this.router.callStatic.exactInput({
        path: encodedPath,
        recipient: this.signer.address,
        amountIn,
        amountOutMinimum: 0n,
      });

      const toleranceBps = Math.floor(this.config.slippageTolerance * 10_000);
      const minOut = (quote * BigInt(10_000 - toleranceBps)) / 10_000n;
      return minOut > 0n ? minOut : 0n;
    } catch (error) {
      logger.warn('Failed to derive minOut for multi-hop swap, using provided fallback', {
        path,
        error: (error as Error).message,
      });
      return providedMin;
    }
  }

  private deriveAmountOutFromLogs(logs: ReadonlyArray<Log> | undefined, tokenOut: Address, recipient: Address): bigint | undefined {
    if (!logs || logs.length === 0) {
      return undefined;
    }

    const net = this.getNetTokenDelta(logs, tokenOut, recipient);
    if (net === undefined || net <= 0n) {
      return undefined;
    }

    return net;
  }

  private getNetTokenDelta(logs: ReadonlyArray<Log>, token: Address, account: Address): bigint | undefined {
    const tokenLc = token.toLowerCase();
    const accountLc = account.toLowerCase();
    let delta = 0n;

    for (const log of logs) {
      if (log.address.toLowerCase() !== tokenLc) continue;
      if (!log.topics || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;

      try {
        const parsed = this.erc20Interface.parseLog(log);
        if (!parsed) continue;
        const from: string = (parsed.args as any).from;
        const to: string = (parsed.args as any).to;
        const value: bigint = BigInt((parsed.args as any).value.toString());

        if (from.toLowerCase() === accountLc) {
          delta -= value;
        }
        if (to.toLowerCase() === accountLc) {
          delta += value;
        }
      } catch (error) {
        logger.debug('Failed to parse transfer log while deriving amountOut', {
          token,
          error: (error as Error).message,
        });
      }
    }

    return delta !== 0n ? delta : undefined;
  }
}

export default SwapExecutor;

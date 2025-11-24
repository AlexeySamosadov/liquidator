import { AbiCoder, Contract, JsonRpcProvider, Signer } from 'ethers';
import {
  BotConfig,
  FlashLoanParams,
  LiquidatablePosition,
  LiquidationMode,
  LiquidationResult,
} from '../../types';
import { PANCAKE_V3_POOL_ABI } from '../../contracts/abis/PancakeV3Pool.abi';
import { logger } from '../../utils/logger';

const FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'];
const FLASH_LIQUIDATOR_ABI = [
  'function executeFlashLiquidation(address pool,address repayToken,address seizeToken,address borrower,uint256 repayAmount,bytes data) external returns (bool)',
];

const COMMON_COUNTERPARTIES = [
  '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  '0x55d398326f99059fF775485246999027B3197955', // USDT
  '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD (legacy)
];

class FlashLoanLiquidator {
  constructor(
    private readonly provider: JsonRpcProvider,
    private readonly config: BotConfig,
    private readonly liquidationBonusPercent: number,
    private readonly signer: Signer,
  ) {}

  private async findPool(token: string): Promise<string | null> {
    if (!this.config.dex.pancakeswapV3Factory) return null;
    const factory = new Contract(this.config.dex.pancakeswapV3Factory, FACTORY_ABI, this.provider);
    const feeTiers = [500, 2500, 10000];

    for (const counterparty of COMMON_COUNTERPARTIES) {
      for (const fee of feeTiers) {
        try {
          const pool: string = await factory.getPool(token, counterparty, fee);
          if (pool && pool !== '0x0000000000000000000000000000000000000000') {
            logger.debug('Found Pancake V3 pool', { pool, token, counterparty, fee });
            return pool;
          }
        } catch (error) {
          logger.warn('Failed to query pool', { error: (error as Error).message, token, counterparty, fee });
        }
      }
    }
    return null;
  }

  private async prepareFlashLoanParams(position: LiquidatablePosition): Promise<FlashLoanParams> {
    const poolAddress = await this.findPool(position.repayToken);
    if (!poolAddress) {
      throw new Error('No suitable flash loan pool found');
    }

    const pool = new Contract(poolAddress, PANCAKE_V3_POOL_ABI, this.provider);
    const token0: string = await pool.token0();
    const amount0 = token0.toLowerCase() === position.repayToken.toLowerCase() ? position.repayAmount : 0n;
    const amount1 = amount0 === 0n ? position.repayAmount : 0n;

    const calldata = AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'uint256'],
      [position.borrower, position.repayToken, position.seizeToken, position.repayAmount],
    );

    const fee = this.config.flashLoanFeeBps;

    const params: FlashLoanParams = {
      poolAddress,
      token: position.repayToken,
      amount: position.repayAmount,
      fee,
      calldata,
    };

    logger.debug('Flash loan params prepared', { ...params, amount0: amount0.toString(), amount1: amount1.toString() });
    return params;
  }

  async executeLiquidation(
    position: LiquidatablePosition,
    gasParams: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  ): Promise<LiquidationResult> {
    try {
      if (!this.config.flashLiquidatorContract) {
        return {
          success: false,
          error: 'Flash liquidator contract not deployed. Deploy contract first or use standard liquidation.',
          mode: LiquidationMode.FLASH_LOAN,
          timestamp: Date.now(),
        };
      }

      const flashLoanParams = await this.prepareFlashLoanParams(position);
      const liquidator = new Contract(this.config.flashLiquidatorContract, FLASH_LIQUIDATOR_ABI, this.signer);

      const tx = await liquidator.executeFlashLiquidation(
        flashLoanParams.poolAddress,
        position.repayToken,
        position.seizeToken,
        position.borrower,
        position.repayAmount,
        flashLoanParams.calldata,
        {
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
        },
      );

      const receipt = await tx.wait();
      const gasUsed = receipt?.gasUsed ? BigInt(receipt.gasUsed) : undefined;
      const gasPriceGwei = Number(gasParams.maxFeePerGas) / 1e9;

      const result: LiquidationResult = {
        success: true,
        txHash: tx.hash,
        mode: LiquidationMode.FLASH_LOAN,
        repayAmount: position.repayAmount,
        seizeAmount: undefined,
        repayToken: position.repayToken,
        seizeToken: position.seizeToken,
        gasUsed,
        gasPriceGwei,
        liquidationBonus: this.liquidationBonusPercent,
        flashLoanFee: this.config.flashLoanFeeBps,
        timestamp: Date.now(),
        profitUsd: position.estimatedProfitUsd,
      };

      logger.info('Flash loan liquidation executed', { borrower: position.borrower, txHash: tx.hash });
      return result;
    } catch (error) {
      logger.error('Flash loan liquidation failed', { error: (error as Error).message, borrower: position.borrower });
      return {
        success: false,
        error: (error as Error).message,
        mode: LiquidationMode.FLASH_LOAN,
        timestamp: Date.now(),
      };
    }
  }
}

export default FlashLoanLiquidator;

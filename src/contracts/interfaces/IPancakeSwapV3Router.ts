import { BaseContract, BigNumberish, ContractTransactionResponse } from 'ethers';
import { ExactInputParams, ExactInputSingleParams } from '../abis/PancakeSwapV3Router.abi';

export interface IPancakeSwapV3Router extends BaseContract {
  exactInputSingle(params: ExactInputSingleParams): Promise<ContractTransactionResponse>;
  exactInput(params: ExactInputParams): Promise<ContractTransactionResponse>;
  unwrapWETH9(amountMinimum: BigNumberish, recipient: string): Promise<ContractTransactionResponse>;
}

export type { ExactInputParams, ExactInputSingleParams };

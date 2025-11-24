import { Contract, ContractTransactionResponse } from 'ethers';
import { Address } from '../../types';

/**
 * Interface for PancakeSwap V3 liquidity pool supporting flash loans.
 * Flash loans use `flash(recipient, amount0, amount1, data)` and expect
 * the recipient contract to implement `pancakeV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data)`.
 * Fees are calculated as amountBorrowed * fee / 1e6.
 */
export interface IPancakeV3Pool extends Contract {
  [name: string]: any;
  flash(recipient: Address, amount0: bigint, amount1: bigint, data: string): Promise<ContractTransactionResponse>;
  token0(): Promise<Address>;
  token1(): Promise<Address>;
  fee(): Promise<number>;
}

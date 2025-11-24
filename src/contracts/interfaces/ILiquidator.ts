import { Contract, ContractTransactionResponse } from 'ethers';
import { Address } from '../../types';

/**
 * Typed interface for Venus Liquidator helper contract.
 */
export interface ILiquidator extends Contract {
  [name: string]: any;
  liquidateBorrow(
    vTokenBorrowed: Address,
    borrower: Address,
    repayAmount: bigint,
    vTokenCollateral: Address,
  ): Promise<ContractTransactionResponse>;
}

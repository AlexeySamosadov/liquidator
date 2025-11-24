import { Contract, ContractTransactionResponse } from 'ethers';
import { AccountSnapshot, Address } from '../../types';

/**
 * Typed interface for Venus vToken contracts (including vBNB wrapper).
 *
 * Note: the vBNB market (native BNB wrapper) does not implement `underlying()` and the call will
 * revert if invoked against that contract. Consumers should guard calls to `underlying()` by
 * checking the market (or handling errors) when iterating over all vTokens.
 */
export interface IVToken extends Contract {
  [name: string]: any;
  /**
   * Returns the underlying BEP-20 token address. Not available on vBNB.
   */
  underlying(): Promise<Address>;
  exchangeRateStored(): Promise<bigint>;
  borrowBalanceStored(account: Address): Promise<bigint>;
  balanceOf(account: Address): Promise<bigint>;
  symbol(): Promise<string>;
  decimals(): Promise<number>;
  getAccountSnapshot(account: Address): Promise<AccountSnapshot>;
  liquidateBorrow(borrower: Address, repayAmount: bigint, vTokenCollateral: Address): Promise<ContractTransactionResponse>;
}

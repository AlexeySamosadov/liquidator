import { Contract } from 'ethers';
import { Address, AccountLiquidity } from '../../types';

/**
 * Typed interface for Venus Comptroller contract.
 * Mantissa values are scaled by 1e18 unless noted otherwise.
 */
export interface IComptroller extends Contract {
  [name: string]: any;
  getAllMarkets(): Promise<Address[]>;
  getAccountLiquidity(account: Address): Promise<AccountLiquidity>;
  getAssetsIn(account: Address): Promise<Address[]>;
  oracle(): Promise<Address>;
  liquidatorContract(): Promise<Address>;
  liquidationIncentiveMantissa(): Promise<bigint>;
}

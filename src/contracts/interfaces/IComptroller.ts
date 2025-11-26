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
  // ✅ Коментируем устаревшую функцию
  // liquidationIncentiveMantissa(): Promise<bigint>;
  // ✅ Добавляем новые функции Diamond для получения LI по рынку
  getLiquidationIncentive(vToken: Address): Promise<bigint>;
  getEffectiveLiquidationIncentive(account: Address, vToken: Address): Promise<bigint>;
  markets(vToken: Address): Promise<{
    isListed: boolean;
    collateralFactorMantissa: bigint;
    liquidationThresholdMantissa: bigint;
    liquidationIncentiveMantissa: bigint;
  }>;
}

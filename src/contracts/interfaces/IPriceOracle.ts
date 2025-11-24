import { Contract } from 'ethers';
import { Address } from '../../types';

/**
 * Typed interface for Venus resilient price oracle.
 * Prices are scaled by 1e(36 - underlyingDecimals).
 */
export interface IPriceOracle extends Contract {
  [name: string]: any;
  getUnderlyingPrice(vToken: Address): Promise<bigint>;
}

/**
 * TypeScript interface for GMX V2 DataStore contract
 */

import { Contract } from 'ethers';
import { Address } from '../../types';

/**
 * Interface for GMX V2 DataStore contract methods
 */
export interface IGMXDataStore extends Contract {
  // Position queries
  getBytes32Count(setKey: string): Promise<bigint>;

  getBytes32ValuesAt(
    setKey: string,
    start: bigint,
    end: bigint
  ): Promise<string[]>;

  getAccountPositionCount(account: Address): Promise<bigint>;

  getAccountPositionKeys(
    account: Address,
    start: bigint,
    end: bigint
  ): Promise<string[]>;

  // Market queries
  getAddressCount(setKey: string): Promise<bigint>;

  getAddressValuesAt(
    setKey: string,
    start: bigint,
    end: bigint
  ): Promise<Address[]>;

  // Generic getters
  getUint(key: string): Promise<bigint>;

  getInt(key: string): Promise<bigint>;

  getAddress(key: string): Promise<Address>;

  getBool(key: string): Promise<boolean>;

  getBytes32(key: string): Promise<string>;

  // Contains checks
  containsBytes32(setKey: string, value: string): Promise<boolean>;

  containsAddress(setKey: string, value: Address): Promise<boolean>;
}

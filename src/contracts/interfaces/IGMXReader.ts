/**
 * TypeScript interface for GMX V2 Reader contract
 */

import { Contract } from 'ethers';
import { Address } from '../../types';

// Price tuple structure
export interface PriceTuple {
  min: bigint;
  max: bigint;
}

// Market prices structure
export interface MarketPrices {
  indexTokenPrice: PriceTuple;
  longTokenPrice: PriceTuple;
  shortTokenPrice: PriceTuple;
}

// Market structure
export interface Market {
  marketToken: Address;
  indexToken: Address;
  longToken: Address;
  shortToken: Address;
}

// Position structure (raw from contract)
export interface PositionStruct {
  account: Address;
  market: Address;
  collateralToken: Address;
  sizeInUsd: bigint;
  sizeInTokens: bigint;
  collateralAmount: bigint;
  borrowingFactor: bigint;
  fundingFeeAmountPerSize: bigint;
  longTokenClaimableFundingAmountPerSize: bigint;
  shortTokenClaimableFundingAmountPerSize: bigint;
  increasedAtBlock: bigint;
  decreasedAtBlock: bigint;
  isLong: boolean;
}

// Position info structure (with fees and PnL)
export interface PositionInfo {
  position: PositionStruct;
  fees: {
    funding: {
      fundingFeeAmount: bigint;
      claimableLongTokenAmount: bigint;
      claimableShortTokenAmount: bigint;
      latestFundingFeeAmountPerSize: bigint;
      latestLongTokenClaimableFundingAmountPerSize: bigint;
      latestShortTokenClaimableFundingAmountPerSize: bigint;
    };
    borrowing: {
      borrowingFeeUsd: bigint;
      borrowingFeeAmount: bigint;
      borrowingFeeReceiverFactor: bigint;
      borrowingFeeAmountForFeeReceiver: bigint;
    };
    ui: {
      uiFeeReceiver: Address;
      uiFeeReceiverFactor: bigint;
      uiFeeAmount: bigint;
    };
    collateralTokenPrice: PriceTuple;
    positionFeeFactor: bigint;
    protocolFeeAmount: bigint;
    positionFeeReceiverFactor: bigint;
    feeReceiverAmount: bigint;
    feeAmountForPool: bigint;
    positionFeeAmountForPool: bigint;
    positionFeeAmount: bigint;
    totalCostAmountExcludingFunding: bigint;
    totalCostAmount: bigint;
  };
  executionPriceResult: {
    priceImpactUsd: bigint;
    priceImpactDiffUsd: bigint;
    executionPrice: bigint;
  };
  basePnlUsd: bigint;
  uncappedBasePnlUsd: bigint;
  pnlAfterPriceImpactUsd: bigint;
}

// Liquidation check result
export interface IsPositionLiquidatableInfo {
  minCollateralUsd: bigint;
  collateralUsd: bigint;
  minCollateralFactor: bigint;
  minCollateralFactorForOpenInterest: bigint;
}

export interface LiquidatableResult {
  isLiquidatable: boolean;
  reason: string;
  info: IsPositionLiquidatableInfo;
}

/**
 * Interface for GMX V2 Reader contract methods
 */
export interface IGMXReader extends Contract {
  // Position queries
  getPosition(dataStore: Address, key: string): Promise<PositionStruct>;

  getAccountPositions(
    dataStore: Address,
    account: Address,
    start: bigint,
    end: bigint
  ): Promise<PositionStruct[]>;

  getPositionInfo(
    dataStore: Address,
    referralStorage: Address,
    positionKey: string,
    prices: MarketPrices,
    sizeDeltaUsd: bigint,
    uiFeeReceiver: Address,
    usePositionSizeAsSizeDeltaUsd: boolean
  ): Promise<PositionInfo>;

  getPositionInfoList(
    dataStore: Address,
    referralStorage: Address,
    positionKeys: string[],
    prices: MarketPrices[],
    uiFeeReceiver: Address
  ): Promise<PositionInfo[]>;

  getAccountPositionInfoList(
    dataStore: Address,
    referralStorage: Address,
    account: Address,
    markets: Address[],
    marketPrices: MarketPrices[],
    uiFeeReceiver: Address,
    start: bigint,
    end: bigint
  ): Promise<PositionInfo[]>;

  // Liquidation check
  isPositionLiquidatable(
    dataStore: Address,
    referralStorage: Address,
    positionKey: string,
    market: Market,
    prices: MarketPrices,
    shouldValidateMinCollateralUsd: boolean
  ): Promise<[boolean, string, IsPositionLiquidatableInfo]>;

  // Market queries
  getMarket(dataStore: Address, key: Address): Promise<Market>;

  getMarkets(
    dataStore: Address,
    start: bigint,
    end: bigint
  ): Promise<Market[]>;

  getMarketInfo(
    dataStore: Address,
    prices: MarketPrices,
    marketKey: Address
  ): Promise<any>;

  getMarketInfoList(
    dataStore: Address,
    marketPricesList: MarketPrices[],
    start: bigint,
    end: bigint
  ): Promise<any[]>;

  // PnL queries
  getPositionPnlUsd(
    dataStore: Address,
    market: Market,
    prices: MarketPrices,
    positionKey: string,
    sizeDeltaUsd: bigint
  ): Promise<[bigint, bigint, bigint]>;

  getNetPnl(
    dataStore: Address,
    market: Market,
    indexTokenPrice: PriceTuple,
    maximize: boolean
  ): Promise<bigint>;

  getPnl(
    dataStore: Address,
    market: Market,
    indexTokenPrice: PriceTuple,
    isLong: boolean,
    maximize: boolean
  ): Promise<bigint>;
}

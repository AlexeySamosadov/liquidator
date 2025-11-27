/**
 * TypeScript interface for GMX V2 ExchangeRouter contract
 */

import { Address } from '../../types';

// Order type enum
export enum OrderType {
  MarketSwap = 0,
  LimitSwap = 1,
  MarketIncrease = 2,
  LimitIncrease = 3,
  MarketDecrease = 4,
  LimitDecrease = 5,
  StopLossDecrease = 6,
  Liquidation = 7
}

// Decrease position swap type
export enum DecreasePositionSwapType {
  NoSwap = 0,
  SwapPnlTokenToCollateralToken = 1,
  SwapCollateralTokenToPnlToken = 2
}

// Create order parameters
export interface CreateOrderParams {
  addresses: {
    receiver: Address;
    callbackContract: Address;
    uiFeeReceiver: Address;
    market: Address;
    initialCollateralToken: Address;
    swapPath: Address[];
  };
  numbers: {
    sizeDeltaUsd: bigint;
    initialCollateralDeltaAmount: bigint;
    triggerPrice: bigint;
    acceptablePrice: bigint;
    executionFee: bigint;
    callbackGasLimit: bigint;
    minOutputAmount: bigint;
  };
  orderType: OrderType;
  decreasePositionSwapType: DecreasePositionSwapType;
  isLong: boolean;
  shouldUnwrapNativeToken: boolean;
  referralCode: string;
}

// Simulate oracle params
export interface SimulateOracleParams {
  primaryTokens: Address[];
  primaryPrices: Array<{
    min: bigint;
    max: bigint;
  }>;
}

/**
 * Interface for GMX V2 ExchangeRouter contract methods
 */
export interface IGMXExchangeRouter {
  // Order creation and management
  createOrder(params: CreateOrderParams): Promise<any>;

  updateOrder(
    key: string,
    sizeDeltaUsd: bigint,
    acceptablePrice: bigint,
    triggerPrice: bigint,
    minOutputAmount: bigint
  ): Promise<any>;

  cancelOrder(key: string): Promise<any>;

  simulateExecuteOrder(
    key: string,
    simulatedOracleParams: SimulateOracleParams
  ): Promise<any>;

  // Claim functions
  claimFundingFees(
    markets: Address[],
    tokens: Address[],
    receiver: Address
  ): Promise<any>;

  claimCollateral(
    markets: Address[],
    tokens: Address[],
    timeKeys: bigint[],
    receiver: Address
  ): Promise<any>;

  // Deposit/Withdrawal
  createDeposit(params: any): Promise<any>;

  cancelDeposit(key: string): Promise<any>;

  createWithdrawal(params: any): Promise<any>;

  cancelWithdrawal(key: string): Promise<any>;

  // Callback contract
  setSavedCallbackContract(
    market: Address,
    callbackContract: Address
  ): Promise<any>;
}

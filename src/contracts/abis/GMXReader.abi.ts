/**
 * GMX V2 Reader Contract ABI
 * Address: 0x60a0fF4cDaF0f6D496d35a5B7E7f4e81e7bF4D23 (Arbitrum)
 *
 * Used for querying positions, markets, and liquidation status
 */

export const GMX_READER_ABI = [
  // Position queries
  {
    type: 'function',
    name: 'getPosition',
    stateMutability: 'view',
    inputs: [
      { name: 'dataStore', type: 'address' },
      { name: 'key', type: 'bytes32' }
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'account', type: 'address' },
          { name: 'market', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'sizeInUsd', type: 'uint256' },
          { name: 'sizeInTokens', type: 'uint256' },
          { name: 'collateralAmount', type: 'uint256' },
          { name: 'borrowingFactor', type: 'uint256' },
          { name: 'fundingFeeAmountPerSize', type: 'uint256' },
          { name: 'longTokenClaimableFundingAmountPerSize', type: 'uint256' },
          { name: 'shortTokenClaimableFundingAmountPerSize', type: 'uint256' },
          { name: 'increasedAtBlock', type: 'uint256' },
          { name: 'decreasedAtBlock', type: 'uint256' },
          { name: 'isLong', type: 'bool' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'getAccountPositions',
    stateMutability: 'view',
    inputs: [
      { name: 'dataStore', type: 'address' },
      { name: 'account', type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'end', type: 'uint256' }
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'account', type: 'address' },
          { name: 'market', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'sizeInUsd', type: 'uint256' },
          { name: 'sizeInTokens', type: 'uint256' },
          { name: 'collateralAmount', type: 'uint256' },
          { name: 'borrowingFactor', type: 'uint256' },
          { name: 'fundingFeeAmountPerSize', type: 'uint256' },
          { name: 'longTokenClaimableFundingAmountPerSize', type: 'uint256' },
          { name: 'shortTokenClaimableFundingAmountPerSize', type: 'uint256' },
          { name: 'increasedAtBlock', type: 'uint256' },
          { name: 'decreasedAtBlock', type: 'uint256' },
          { name: 'isLong', type: 'bool' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'getPositionInfo',
    stateMutability: 'view',
    inputs: [
      { name: 'dataStore', type: 'address' },
      { name: 'referralStorage', type: 'address' },
      { name: 'positionKey', type: 'bytes32' },
      {
        name: 'prices',
        type: 'tuple',
        components: [
          {
            name: 'indexTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          },
          {
            name: 'longTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          },
          {
            name: 'shortTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          }
        ]
      },
      { name: 'sizeDeltaUsd', type: 'uint256' },
      { name: 'uiFeeReceiver', type: 'address' },
      { name: 'usePositionSizeAsSizeDeltaUsd', type: 'bool' }
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          {
            name: 'position',
            type: 'tuple',
            components: [
              { name: 'account', type: 'address' },
              { name: 'market', type: 'address' },
              { name: 'collateralToken', type: 'address' },
              { name: 'sizeInUsd', type: 'uint256' },
              { name: 'sizeInTokens', type: 'uint256' },
              { name: 'collateralAmount', type: 'uint256' },
              { name: 'borrowingFactor', type: 'uint256' },
              { name: 'fundingFeeAmountPerSize', type: 'uint256' },
              { name: 'longTokenClaimableFundingAmountPerSize', type: 'uint256' },
              { name: 'shortTokenClaimableFundingAmountPerSize', type: 'uint256' },
              { name: 'increasedAtBlock', type: 'uint256' },
              { name: 'decreasedAtBlock', type: 'uint256' },
              { name: 'isLong', type: 'bool' }
            ]
          },
          {
            name: 'fees',
            type: 'tuple',
            components: [
              {
                name: 'funding',
                type: 'tuple',
                components: [
                  { name: 'fundingFeeAmount', type: 'uint256' },
                  { name: 'claimableLongTokenAmount', type: 'uint256' },
                  { name: 'claimableShortTokenAmount', type: 'uint256' },
                  { name: 'latestFundingFeeAmountPerSize', type: 'uint256' },
                  { name: 'latestLongTokenClaimableFundingAmountPerSize', type: 'uint256' },
                  { name: 'latestShortTokenClaimableFundingAmountPerSize', type: 'uint256' }
                ]
              },
              {
                name: 'borrowing',
                type: 'tuple',
                components: [
                  { name: 'borrowingFeeUsd', type: 'uint256' },
                  { name: 'borrowingFeeAmount', type: 'uint256' },
                  { name: 'borrowingFeeReceiverFactor', type: 'uint256' },
                  { name: 'borrowingFeeAmountForFeeReceiver', type: 'uint256' }
                ]
              },
              {
                name: 'ui',
                type: 'tuple',
                components: [
                  { name: 'uiFeeReceiver', type: 'address' },
                  { name: 'uiFeeReceiverFactor', type: 'uint256' },
                  { name: 'uiFeeAmount', type: 'uint256' }
                ]
              },
              {
                name: 'collateralTokenPrice',
                type: 'tuple',
                components: [
                  { name: 'min', type: 'uint256' },
                  { name: 'max', type: 'uint256' }
                ]
              },
              { name: 'positionFeeFactor', type: 'uint256' },
              { name: 'protocolFeeAmount', type: 'uint256' },
              { name: 'positionFeeReceiverFactor', type: 'uint256' },
              { name: 'feeReceiverAmount', type: 'uint256' },
              { name: 'feeAmountForPool', type: 'uint256' },
              { name: 'positionFeeAmountForPool', type: 'uint256' },
              { name: 'positionFeeAmount', type: 'uint256' },
              { name: 'totalCostAmountExcludingFunding', type: 'uint256' },
              { name: 'totalCostAmount', type: 'uint256' }
            ]
          },
          {
            name: 'executionPriceResult',
            type: 'tuple',
            components: [
              { name: 'priceImpactUsd', type: 'int256' },
              { name: 'priceImpactDiffUsd', type: 'uint256' },
              { name: 'executionPrice', type: 'uint256' }
            ]
          },
          { name: 'basePnlUsd', type: 'int256' },
          { name: 'uncappedBasePnlUsd', type: 'int256' },
          { name: 'pnlAfterPriceImpactUsd', type: 'int256' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'isPositionLiquidatable',
    stateMutability: 'view',
    inputs: [
      { name: 'dataStore', type: 'address' },
      { name: 'referralStorage', type: 'address' },
      { name: 'positionKey', type: 'bytes32' },
      {
        name: 'market',
        type: 'tuple',
        components: [
          { name: 'marketToken', type: 'address' },
          { name: 'indexToken', type: 'address' },
          { name: 'longToken', type: 'address' },
          { name: 'shortToken', type: 'address' }
        ]
      },
      {
        name: 'prices',
        type: 'tuple',
        components: [
          {
            name: 'indexTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          },
          {
            name: 'longTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          },
          {
            name: 'shortTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          }
        ]
      },
      { name: 'shouldValidateMinCollateralUsd', type: 'bool' }
    ],
    outputs: [
      { name: 'isLiquidatable', type: 'bool' },
      { name: 'reason', type: 'string' },
      {
        type: 'tuple',
        components: [
          { name: 'minCollateralUsd', type: 'int256' },
          { name: 'collateralUsd', type: 'int256' },
          { name: 'minCollateralFactor', type: 'uint256' },
          { name: 'minCollateralFactorForOpenInterest', type: 'uint256' }
        ]
      }
    ]
  },

  // Market queries
  {
    type: 'function',
    name: 'getMarket',
    stateMutability: 'view',
    inputs: [
      { name: 'dataStore', type: 'address' },
      { name: 'key', type: 'address' }
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'marketToken', type: 'address' },
          { name: 'indexToken', type: 'address' },
          { name: 'longToken', type: 'address' },
          { name: 'shortToken', type: 'address' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'getMarkets',
    stateMutability: 'view',
    inputs: [
      { name: 'dataStore', type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'end', type: 'uint256' }
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'marketToken', type: 'address' },
          { name: 'indexToken', type: 'address' },
          { name: 'longToken', type: 'address' },
          { name: 'shortToken', type: 'address' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'getMarketInfo',
    stateMutability: 'view',
    inputs: [
      { name: 'dataStore', type: 'address' },
      {
        name: 'prices',
        type: 'tuple',
        components: [
          {
            name: 'indexTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          },
          {
            name: 'longTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          },
          {
            name: 'shortTokenPrice',
            type: 'tuple',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          }
        ]
      },
      { name: 'marketKey', type: 'address' }
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          {
            name: 'market',
            type: 'tuple',
            components: [
              { name: 'marketToken', type: 'address' },
              { name: 'indexToken', type: 'address' },
              { name: 'longToken', type: 'address' },
              { name: 'shortToken', type: 'address' }
            ]
          },
          { name: 'borrowingFactorPerSecondForLongs', type: 'uint256' },
          { name: 'borrowingFactorPerSecondForShorts', type: 'uint256' },
          {
            name: 'baseFunding',
            type: 'tuple',
            components: [
              { name: 'fundingFeeAmountPerSize', type: 'tuple' },
              { name: 'claimableFundingAmountPerSize', type: 'tuple' }
            ]
          },
          {
            name: 'nextFunding',
            type: 'tuple',
            components: [
              { name: 'longsPayShorts', type: 'bool' },
              { name: 'fundingFactorPerSecond', type: 'uint256' },
              { name: 'fundingFeeAmountPerSizeDelta', type: 'tuple' },
              { name: 'claimableFundingAmountPerSizeDelta', type: 'tuple' }
            ]
          },
          {
            name: 'virtualInventory',
            type: 'tuple',
            components: [
              { name: 'virtualPoolAmountForLongToken', type: 'uint256' },
              { name: 'virtualPoolAmountForShortToken', type: 'uint256' },
              { name: 'virtualInventoryForPositions', type: 'int256' }
            ]
          },
          { name: 'isDisabled', type: 'bool' }
        ]
      }
    ]
  }
] as const;

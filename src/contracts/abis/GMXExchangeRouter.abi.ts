/**
 * GMX V2 ExchangeRouter Contract ABI
 * Address: 0x7c68c7866a64fa2160f78eeae12217ffbf871fa8 (Arbitrum)
 *
 * Used for executing orders including liquidations
 */

export const GMX_EXCHANGE_ROUTER_ABI = [
  {
    type: 'function',
    name: 'createOrder',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'addresses',
            type: 'tuple',
            components: [
              { name: 'receiver', type: 'address' },
              { name: 'callbackContract', type: 'address' },
              { name: 'uiFeeReceiver', type: 'address' },
              { name: 'market', type: 'address' },
              { name: 'initialCollateralToken', type: 'address' },
              { name: 'swapPath', type: 'address[]' }
            ]
          },
          {
            name: 'numbers',
            type: 'tuple',
            components: [
              { name: 'sizeDeltaUsd', type: 'uint256' },
              { name: 'initialCollateralDeltaAmount', type: 'uint256' },
              { name: 'triggerPrice', type: 'uint256' },
              { name: 'acceptablePrice', type: 'uint256' },
              { name: 'executionFee', type: 'uint256' },
              { name: 'callbackGasLimit', type: 'uint256' },
              { name: 'minOutputAmount', type: 'uint256' }
            ]
          },
          { name: 'orderType', type: 'uint8' },
          { name: 'decreasePositionSwapType', type: 'uint8' },
          { name: 'isLong', type: 'bool' },
          { name: 'shouldUnwrapNativeToken', type: 'bool' },
          { name: 'referralCode', type: 'bytes32' }
        ]
      }
    ],
    outputs: [{ name: '', type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'updateOrder',
    stateMutability: 'payable',
    inputs: [
      { name: 'key', type: 'bytes32' },
      { name: 'sizeDeltaUsd', type: 'uint256' },
      { name: 'acceptablePrice', type: 'uint256' },
      { name: 'triggerPrice', type: 'uint256' },
      { name: 'minOutputAmount', type: 'uint256' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'cancelOrder',
    stateMutability: 'payable',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'simulateExecuteOrder',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key', type: 'bytes32' },
      {
        name: 'simulatedOracleParams',
        type: 'tuple',
        components: [
          { name: 'primaryTokens', type: 'address[]' },
          {
            name: 'primaryPrices',
            type: 'tuple[]',
            components: [
              { name: 'min', type: 'uint256' },
              { name: 'max', type: 'uint256' }
            ]
          }
        ]
      }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'claimFundingFees',
    stateMutability: 'payable',
    inputs: [
      { name: 'markets', type: 'address[]' },
      { name: 'tokens', type: 'address[]' },
      { name: 'receiver', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256[]' }]
  },
  {
    type: 'function',
    name: 'claimCollateral',
    stateMutability: 'payable',
    inputs: [
      { name: 'markets', type: 'address[]' },
      { name: 'tokens', type: 'address[]' },
      { name: 'timeKeys', type: 'uint256[]' },
      { name: 'receiver', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256[]' }]
  },
  {
    type: 'function',
    name: 'createDeposit',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'receiver', type: 'address' },
          { name: 'callbackContract', type: 'address' },
          { name: 'uiFeeReceiver', type: 'address' },
          { name: 'market', type: 'address' },
          { name: 'initialLongToken', type: 'address' },
          { name: 'initialShortToken', type: 'address' },
          { name: 'longTokenSwapPath', type: 'address[]' },
          { name: 'shortTokenSwapPath', type: 'address[]' },
          { name: 'minMarketTokens', type: 'uint256' },
          { name: 'shouldUnwrapNativeToken', type: 'bool' },
          { name: 'executionFee', type: 'uint256' },
          { name: 'callbackGasLimit', type: 'uint256' }
        ]
      }
    ],
    outputs: [{ name: '', type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'cancelDeposit',
    stateMutability: 'payable',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'createWithdrawal',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'receiver', type: 'address' },
          { name: 'callbackContract', type: 'address' },
          { name: 'uiFeeReceiver', type: 'address' },
          { name: 'market', type: 'address' },
          { name: 'longTokenSwapPath', type: 'address[]' },
          { name: 'shortTokenSwapPath', type: 'address[]' },
          { name: 'minLongTokenAmount', type: 'uint256' },
          { name: 'minShortTokenAmount', type: 'uint256' },
          { name: 'shouldUnwrapNativeToken', type: 'bool' },
          { name: 'executionFee', type: 'uint256' },
          { name: 'callbackGasLimit', type: 'uint256' }
        ]
      }
    ],
    outputs: [{ name: '', type: 'bytes32' }]
  },
  {
    type: 'function',
    name: 'cancelWithdrawal',
    stateMutability: 'payable',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'setSavedCallbackContract',
    stateMutability: 'payable',
    inputs: [
      { name: 'market', type: 'address' },
      { name: 'callbackContract', type: 'address' }
    ],
    outputs: []
  },

  // Events
  {
    type: 'event',
    name: 'OrderCreated',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: false },
      {
        name: 'order',
        type: 'tuple',
        indexed: false,
        components: [
          {
            name: 'addresses',
            type: 'tuple',
            components: [
              { name: 'account', type: 'address' },
              { name: 'receiver', type: 'address' },
              { name: 'callbackContract', type: 'address' },
              { name: 'uiFeeReceiver', type: 'address' },
              { name: 'market', type: 'address' },
              { name: 'initialCollateralToken', type: 'address' },
              { name: 'swapPath', type: 'address[]' }
            ]
          },
          {
            name: 'numbers',
            type: 'tuple',
            components: [
              { name: 'orderType', type: 'uint256' },
              { name: 'decreasePositionSwapType', type: 'uint256' },
              { name: 'sizeDeltaUsd', type: 'uint256' },
              { name: 'initialCollateralDeltaAmount', type: 'uint256' },
              { name: 'triggerPrice', type: 'uint256' },
              { name: 'acceptablePrice', type: 'uint256' },
              { name: 'executionFee', type: 'uint256' },
              { name: 'callbackGasLimit', type: 'uint256' },
              { name: 'minOutputAmount', type: 'uint256' },
              { name: 'updatedAtBlock', type: 'uint256' }
            ]
          },
          {
            name: 'flags',
            type: 'tuple',
            components: [
              { name: 'isLong', type: 'bool' },
              { name: 'shouldUnwrapNativeToken', type: 'bool' },
              { name: 'isFrozen', type: 'bool' }
            ]
          }
        ]
      }
    ]
  },
  {
    type: 'event',
    name: 'OrderExecuted',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'account', type: 'address', indexed: true }
    ]
  },
  {
    type: 'event',
    name: 'OrderCancelled',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'reason', type: 'string', indexed: false }
    ]
  }
] as const;

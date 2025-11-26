export const COMPTROLLER_ABI = [
  {
    inputs: [],
    name: 'getAllMarkets',
    outputs: [
      {
        internalType: 'address[]',
        name: '',
        type: 'address[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'getAccountLiquidity',
    outputs: [
      { internalType: 'uint256', name: 'error', type: 'uint256' },
      { internalType: 'uint256', name: 'liquidity', type: 'uint256' },
      { internalType: 'uint256', name: 'shortfall', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'getAssetsIn',
    outputs: [
      {
        internalType: 'address[]',
        name: '',
        type: 'address[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'oracle',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'liquidatorContract',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // ✅ УБИРАЕМ УСТАРЕВШУЮ ФУНКЦИЮ и ставим DIAMOND FUNCTIONS
  // Устаревшая: liquidationIncentiveMantissa()
  // Новая DIAMOND FUNCTIONS (Core Pool MarketFacet)
  {
    inputs: [
      {
        internalType: 'address',
        name: 'vToken',
        type: 'address' as const,
      },
    ],
    name: 'getLiquidationIncentive',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256' as const,
      },
    ],
    stateMutability: 'view',
    type: 'function' as const,
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'vToken',
        type: 'address' as const,
      },
    ],
    name: 'markets',
    outputs: [
      {
        components: [
          { internalType: 'bool', name: 'isListed', type: 'bool' as const },
          {
            internalType: 'uint256',
            name: 'collateralFactorMantissa',
            type: 'uint256' as const,
          },
          {
            internalType: 'uint256',
            name: 'liquidationThresholdMantissa',
            type: 'uint256' as const,
          },
          {
            internalType: 'uint256',
            name: 'liquidationIncentiveMantissa',
            type: 'uint256' as const,
          },
          { internalType: 'uint256', name: 'minLiquidatableCollateral', type: 'uint256' as const },
          { internalType: 'uint256', name: 'borrowCap', type: 'uint256' as const },
          { internalType: 'uint256', name: 'supplyCap', type: 'uint256' as const },
        ],
        internalType: 'struct Market',
        name: '',
        type: 'tuple' as const,
      },
    ],
    stateMutability: 'view',
    type: 'function' as const,
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address' as const,
      },
      {
        internalType: 'address',
        name: 'vToken',
        type: 'address' as const,
      },
    ],
    name: 'getEffectiveLiquidationIncentive',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256' as const,
      },
    ],
    stateMutability: 'view',
    type: 'function' as const,
  },
];

export default COMPTROLLER_ABI;

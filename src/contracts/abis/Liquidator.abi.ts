export const LIQUIDATOR_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'vTokenBorrowed', type: 'address' },
      { internalType: 'address', name: 'borrower', type: 'address' },
      { internalType: 'uint256', name: 'repayAmount', type: 'uint256' },
      { internalType: 'address', name: 'vTokenCollateral', type: 'address' },
    ],
    name: 'liquidateBorrow',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

export default LIQUIDATOR_ABI;

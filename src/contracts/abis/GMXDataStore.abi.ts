/**
 * GMX V2 DataStore Contract ABI
 * Address: 0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8 (Arbitrum)
 *
 * Used for reading market data, position counts, and configuration
 */

export const GMX_DATASTORE_ABI = [
  // Position count queries
  {
    type: 'function',
    name: 'getBytes32Count',
    stateMutability: 'view',
    inputs: [{ name: 'setKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'getBytes32ValuesAt',
    stateMutability: 'view',
    inputs: [
      { name: 'setKey', type: 'bytes32' },
      { name: 'start', type: 'uint256' },
      { name: 'end', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bytes32[]' }]
  },

  // Account position keys
  {
    type: 'function',
    name: 'getAccountPositionCount',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'getAccountPositionKeys',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'end', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bytes32[]' }]
  },

  // Market queries
  {
    type: 'function',
    name: 'getAddressCount',
    stateMutability: 'view',
    inputs: [{ name: 'setKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'getAddressValuesAt',
    stateMutability: 'view',
    inputs: [
      { name: 'setKey', type: 'bytes32' },
      { name: 'start', type: 'uint256' },
      { name: 'end', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'address[]' }]
  },

  // Generic getters for market parameters
  {
    type: 'function',
    name: 'getUint',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'getInt',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ name: '', type: 'int256' }]
  },
  {
    type: 'function',
    name: 'getAddress',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'getBool',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'getBytes32',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32' }]
  },

  // Contains checks
  {
    type: 'function',
    name: 'containsBytes32',
    stateMutability: 'view',
    inputs: [
      { name: 'setKey', type: 'bytes32' },
      { name: 'value', type: 'bytes32' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'containsAddress',
    stateMutability: 'view',
    inputs: [
      { name: 'setKey', type: 'bytes32' },
      { name: 'value', type: 'address' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

// DataStore keys for common queries
// These are keccak256 hashes of the key strings
export const DATASTORE_KEYS = {
  // Market list key: keccak256(abi.encode("MARKET_LIST"))
  MARKET_LIST: '0x322a36636730e52d3a3d473d287969b8d254091749d307a4bc8564615f348953', // keccak256(abi.encode("MARKET_LIST"))

  // Position list key: keccak256(abi.encode("POSITION_LIST"))
  POSITION_LIST: '0x87b980e55d5de835d943047a8067969cc247f13b8417c69804c6025aeda6b0e1', // keccak256(abi.encode("POSITION_LIST"))

  // Account position list key prefix: keccak256(abi.encode("ACCOUNT_POSITION_LIST"))
  ACCOUNT_POSITION_LIST: '0x995323226d535537624c7397fc57c9e42151725f108b516d46029b5264866897', // keccak256(abi.encode("ACCOUNT_POSITION_LIST"))
} as const;

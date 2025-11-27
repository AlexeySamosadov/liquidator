// Aave V3 Pool Contract Interface
export const AAVE_V3_POOL_ABI = [
    // Read Functions
    {
        inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
        name: 'getUserAccountData',
        outputs: [
            { internalType: 'uint256', name: 'totalCollateralBase', type: 'uint256' },
            { internalType: 'uint256', name: 'totalDebtBase', type: 'uint256' },
            { internalType: 'uint256', name: 'availableBorrowsBase', type: 'uint256' },
            { internalType: 'uint256', name: 'currentLiquidationThreshold', type: 'uint256' },
            { internalType: 'uint256', name: 'ltv', type: 'uint256' },
            { internalType: 'uint256', name: 'healthFactor', type: 'uint256' }
        ],
        stateMutability: 'view',
        type: 'function'
    },
    // Liquidation Function
    {
        inputs: [
            { internalType: 'address', name: 'collateralAsset', type: 'address' },
            { internalType: 'address', name: 'debtAsset', type: 'address' },
            { internalType: 'address', name: 'user', type: 'address' },
            { internalType: 'uint256', name: 'debtToCover', type: 'uint256' },
            { internalType: 'bool', name: 'receiveAToken', type: 'bool' }
        ],
        name: 'liquidationCall',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function'
    },
    // Flash Loan
    {
        inputs: [
            { internalType: 'address', name: 'receiverAddress', type: 'address' },
            { internalType: 'address[]', name: 'assets', type: 'address[]' },
            { internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' },
            { internalType: 'uint256[]', name: 'interestRateModes', type: 'uint256[]' },
            { internalType: 'address', name: 'onBehalfOf', type: 'address' },
            { internalType: 'bytes', name: 'params', type: 'bytes' },
            { internalType: 'uint16', name: 'referralCode', type: 'uint16' }
        ],
        name: 'flashLoan',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function'
    }
] as const;

// Aave V3 Arbitrum Addresses
export const AAVE_V3_ARBITRUM = {
    POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',

    // Common collateral tokens
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    USDC: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',

    // Flash loan fee: 0.09%
    FLASH_LOAN_FEE_PERCENTAGE: 9n, // 9 basis points
    FLASH_LOAN_FEE_DIVISOR: 10000n
} as const;

export const HEALTH_FACTOR_LIQUIDATION_THRESHOLD = 1e18; // 1.0 in 18 decimals

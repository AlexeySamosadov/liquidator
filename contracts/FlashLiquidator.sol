// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IFlashLoanSimpleReceiver} from "@aave/core-v3/contracts/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FlashLiquidator
 * @notice Executes atomic liquidations using Aave V3 flash loans
 * @dev Flash borrows debt asset -> Liquidates position -> Swaps collateral -> Repays loan + fee -> Profit
 */
contract FlashLiquidator is IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    address public immutable owner;
    IPoolAddressesProvider public immutable override ADDRESSES_PROVIDER;
    IPool public immutable override POOL;
    
    // Uniswap V3 SwapRouter
    address public constant SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    
    // ============ Structs ============
    
    struct LiquidationParams {
        address user;              // User to liquidate
        address debtAsset;         // Asset to repay
        address collateralAsset;   // Collateral to receive
        uint256 debtToCover;       // Amount of debt to repay
        uint24 poolFee;           // Uniswap pool fee (3000 = 0.3%)
    }
    
    // ============ Events ============
    
    event LiquidationExecuted(
        address indexed user,
        address debtAsset,
        address collateralAsset,
        uint256 debtCovered,
        uint256 collateralReceived,
        uint256 profit
    );
    
    event Withdrawn(address indexed token, uint256 amount);
    
    // ============ Modifiers ============
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    // ============ Constructor ============
    
    constructor(address _addressesProvider) {
        owner = msg.sender;
        ADDRESSES_PROVIDER = IPoolAddressesProvider(_addressesProvider);
        POOL = IPool(IPoolAddressesProvider(_addressesProvider).getPool());
    }
    
    // ============ External Functions ============
    
    /**
     * @notice Execute flash loan liquidation
     * @param user Address of user to liquidate
     * @param debtAsset Address of debt token to repay
     * @param collateralAsset Address of collateral token to receive
     * @param debtToCover Amount of debt to cover
     * @param poolFee Uniswap V3 pool fee (500, 3000, or 10000)
     */
    function executeLiquidation(
        address user,
        address debtAsset,
        address collateralAsset,
        uint256 debtToCover,
        uint24 poolFee
    ) external onlyOwner {
        require(user != address(0), "Invalid user");
        require(debtAsset != address(0), "Invalid debt asset");
        require(collateralAsset != address(0), "Invalid collateral asset");
        require(debtToCover > 0, "Invalid debt amount");
        
        // Encode liquidation parameters
        bytes memory params = abi.encode(
            LiquidationParams({
                user: user,
                debtAsset: debtAsset,
                collateralAsset: collateralAsset,
                debtToCover: debtToCover,
                poolFee: poolFee
            })
        );
        
        // Request flash loan from Aave
        POOL.flashLoanSimple(
            address(this),
            debtAsset,
            debtToCover,
            params,
            0 // referral code
        );
    }
    
    /**
     * @notice Called by Aave Pool after flash loan is sent
     * @dev Executes: liquidate -> swap collateral -> repay loan
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Only pool");
        require(initiator == address(this), "Invalid initiator");
        
        // Decode params
        LiquidationParams memory liq = abi.decode(params, (LiquidationParams));
        
        // Step 1: Approve Pool to pull debt repayment
        IERC20(liq.debtAsset).forceApprove(address(POOL), amount);
        
        // Step 2: Execute liquidation on Aave
        POOL.liquidationCall(
            liq.collateralAsset,
            liq.debtAsset,
            liq.user,
            amount,
            false // receive underlying, not aToken
        );
        
        // Step 3: Get collateral balance
        uint256 collateralReceived = IERC20(liq.collateralAsset).balanceOf(address(this));
        require(collateralReceived > 0, "No collateral received");
        
        // Step 4: Swap collateral for debt asset on Uniswap V3
        uint256 amountOut = _swapOnUniswap(
            liq.collateralAsset,
            liq.debtAsset,
            collateralReceived,
            liq.poolFee
        );
        
        // Step 5: Check profitability
        uint256 totalDebt = amount + premium;
        require(amountOut >= totalDebt, "Unprofitable: swap insufficient");
        
        // Step 6: Approve pool to take flash loan repayment
        IERC20(asset).forceApprove(address(POOL), totalDebt);
        
        // Step 7: Calculate and send profit to owner
        uint256 profit = amountOut - totalDebt;
        if (profit > 0) {
            IERC20(liq.debtAsset).safeTransfer(owner, profit);
        }
        
        emit LiquidationExecuted(
            liq.user,
            liq.debtAsset,
            liq.collateralAsset,
            amount,
            collateralReceived,
            profit
        );
        
        return true;
    }
    
    /**
     * @notice Emergency withdraw stuck tokens
     * @param token Token address to withdraw
     */
    function withdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        
        IERC20(token).safeTransfer(owner, balance);
        emit Withdrawn(token, balance);
    }
    
    // ============ Internal Functions ============
    
    /**
     * @notice Swap tokens on Uniswap V3
     * @dev Uses SwapRouter for single-hop swaps
     */
    function _swapOnUniswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 poolFee
    ) internal returns (uint256 amountOut) {
        // Import Uniswap V3 SwapRouter interface
        ISwapRouter swapRouter = ISwapRouter(SWAP_ROUTER);
        
        // Approve SwapRouter to spend tokens
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        
        // Setup swap params
        ISwapRouter.ExactInputSingleParams memory swapParams = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: poolFee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: 0, // TODO: Add slippage protection in production
            sqrtPriceLimitX96: 0
        });
        
        // Execute swap
        amountOut = swapRouter.exactInputSingle(swapParams);
        require(amountOut > 0, "Swap failed");
    }
    
    // Allow contract to receive ETH
    receive() external payable {}
}

// ============ Interfaces ============

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

/**
 * Bridge USDT from BNB Chain to Arbitrum with ETH gas drop using Stargate
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        logger.error('PRIVATE_KEY not found');
        process.exit(1);
    }

    // Setup BNB Chain provider
    const bscProvider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
    const bscWallet = new ethers.Wallet(privateKey, bscProvider);

    logger.info('='.repeat(80));
    logger.info('Bridge USDT with ETH Gas Drop: BNB Chain → Arbitrum');
    logger.info('='.repeat(80));
    logger.info(`Wallet: ${bscWallet.address}`);

    // USDT on BSC
    const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
    const usdtAbi = [
        'function balanceOf(address) view returns (uint256)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)'
    ];
    const usdt = new ethers.Contract(usdtAddress, usdtAbi, bscWallet);

    // Check balance
    const balance = await usdt.balanceOf(bscWallet.address);
    logger.info(`USDT Balance: ${ethers.formatUnits(balance, 18)} USDT`);

    const amountToSend = ethers.parseUnits('10', 18); // 10 USDT

    if (balance < amountToSend) {
        logger.error(`Insufficient balance. Need 10 USDT, have ${ethers.formatUnits(balance, 18)}`);
        process.exit(1);
    }

    // Stargate Router on BSC
    const stargateRouterAddress = '0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8';

    // Check allowance
    const allowance = await usdt.allowance(bscWallet.address, stargateRouterAddress);
    logger.info(`Current allowance: ${ethers.formatUnits(allowance, 18)} USDT`);

    if (allowance < amountToSend) {
        logger.info('Approving Stargate Router...');
        const approveTx = await usdt.approve(stargateRouterAddress, ethers.MaxUint256);
        logger.info(`Approve tx: ${approveTx.hash}`);
        await approveTx.wait();
        logger.info('✅ Approved');
    }

    // Stargate Router ABI (simplified)
    const stargateRouterAbi = [
        'function swap(uint16 _dstChainId, uint256 _srcPoolId, uint256 _dstPoolId, address payable _refundAddress, uint256 _amountLD, uint256 _minAmountLD, tuple(uint256 dstGasForCall, uint256 dstNativeAmount, bytes dstNativeAddr) _lzTxParams, bytes _to, bytes _payload) payable',
        'function quoteLayerZeroFee(uint16 _dstChainId, uint8 _functionType, bytes _toAddress, bytes _transferAndCallPayload, tuple(uint256 dstGasForCall, uint256 dstNativeAmount, bytes dstNativeAddr) _lzTxParams) view returns (uint256, uint256)'
    ];
    const stargateRouter = new ethers.Contract(stargateRouterAddress, stargateRouterAbi, bscWallet);

    const dstChainId = 110; // Arbitrum on Stargate
    const srcPoolId = 2; // USDT pool on BSC
    const dstPoolId = 1; // USDT pool on Arbitrum

    // Encode destination address
    const toAddressBytes = ethers.solidityPacked(['address'], [bscWallet.address]);

    // LZ transaction params WITH gas drop (0.003 ETH on destination)
    const dstNativeAmount = ethers.parseEther('0.003'); // Request 0.003 ETH on Arbitrum
    const lzTxParams = {
        dstGasForCall: 0,
        dstNativeAmount: dstNativeAmount,
        dstNativeAddr: toAddressBytes
    };

    // Quote fee
    logger.info('Getting LayerZero fee quote with gas drop...');
    const [nativeFee, ] = await stargateRouter.quoteLayerZeroFee(
        dstChainId,
        1, // TYPE_SWAP_REMOTE
        toAddressBytes,
        '0x',
        lzTxParams
    );

    logger.info(`LayerZero fee (including gas drop): ${ethers.formatEther(nativeFee)} BNB`);
    logger.info(`Gas drop on Arbitrum: ${ethers.formatEther(dstNativeAmount)} ETH`);

    const bnbBalance = await bscProvider.getBalance(bscWallet.address);
    logger.info(`BNB Balance: ${ethers.formatEther(bnbBalance)} BNB`);

    if (bnbBalance < nativeFee) {
        logger.error(`Insufficient BNB for bridge fee. Need ${ethers.formatEther(nativeFee)} BNB`);
        process.exit(1);
    }

    logger.info('Executing bridge transaction...');
    logger.info(`Sending: ${ethers.formatUnits(amountToSend, 18)} USDT`);
    logger.info(`Fee: ${ethers.formatEther(nativeFee)} BNB`);
    logger.info(`You will receive: ~${ethers.formatUnits(amountToSend, 18)} USDT + ${ethers.formatEther(dstNativeAmount)} ETH on Arbitrum`);

    const minAmountLD = (amountToSend * 98n) / 100n; // 2% slippage

    const swapTx = await stargateRouter.swap(
        dstChainId,
        srcPoolId,
        dstPoolId,
        bscWallet.address, // refund address
        amountToSend,
        minAmountLD,
        lzTxParams,
        toAddressBytes,
        '0x',
        { value: nativeFee }
    );

    logger.info(`Bridge tx: ${swapTx.hash}`);
    logger.info('Waiting for confirmation...');

    const receipt = await swapTx.wait();
    logger.info(`✅ Transaction confirmed in block ${receipt?.blockNumber}`);
    logger.info('Bridge will take 10-20 minutes to complete on Arbitrum');
    logger.info(`You will receive USDT + ${ethers.formatEther(dstNativeAmount)} ETH for gas!`);
    logger.info('='.repeat(80));
}

main().catch(error => {
    logger.error('Bridge failed:', error);
    process.exit(1);
});

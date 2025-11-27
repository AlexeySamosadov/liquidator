/**
 * Bridge BNB from BNB Chain to ETH on Arbitrum using Stargate
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
    logger.info('Bridge BNB → ETH: BNB Chain → Arbitrum');
    logger.info('='.repeat(80));
    logger.info(`Wallet: ${bscWallet.address}`);

    // Check BNB balance
    const bnbBalance = await bscProvider.getBalance(bscWallet.address);
    logger.info(`BNB Balance: ${ethers.formatEther(bnbBalance)} BNB`);

    // Amount to send: 0.015 BNB (~$9, leaving some for gas)
    const amountToSend = ethers.parseEther('0.015');

    if (bnbBalance < amountToSend) {
        logger.error(`Insufficient balance. Need 0.015 BNB, have ${ethers.formatEther(bnbBalance)}`);
        process.exit(1);
    }

    // Stargate Router on BSC
    const stargateRouterAddress = '0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8';

    // Stargate Router ABI
    const stargateRouterAbi = [
        'function swapETH(uint16 _dstChainId, address payable _refundAddress, bytes _toAddress, uint256 _amountLD, uint256 _minAmountLD) payable',
        'function quoteLayerZeroFee(uint16 _dstChainId, uint8 _functionType, bytes _toAddress, bytes _transferAndCallPayload, tuple(uint256 dstGasForCall, uint256 dstNativeAmount, bytes dstNativeAddr) _lzTxParams) view returns (uint256, uint256)'
    ];
    const stargateRouter = new ethers.Contract(stargateRouterAddress, stargateRouterAbi, bscWallet);

    const dstChainId = 110; // Arbitrum on Stargate

    // Encode destination address
    const toAddressBytes = ethers.solidityPacked(['address'], [bscWallet.address]);

    // LZ transaction params
    const lzTxParams = {
        dstGasForCall: 0,
        dstNativeAmount: 0,
        dstNativeAddr: '0x'
    };

    // Quote fee
    logger.info('Getting LayerZero fee quote...');
    const [nativeFee, ] = await stargateRouter.quoteLayerZeroFee(
        dstChainId,
        1, // TYPE_SWAP_REMOTE
        toAddressBytes,
        '0x',
        lzTxParams
    );

    logger.info(`LayerZero fee: ${ethers.formatEther(nativeFee)} BNB`);

    const totalNeeded = amountToSend + nativeFee;

    if (bnbBalance < totalNeeded) {
        logger.error(`Insufficient BNB. Need ${ethers.formatEther(totalNeeded)} BNB total (${ethers.formatEther(amountToSend)} + ${ethers.formatEther(nativeFee)} fee)`);
        process.exit(1);
    }

    logger.info('Executing bridge transaction...');
    logger.info(`Sending: ${ethers.formatEther(amountToSend)} BNB`);
    logger.info(`Fee: ${ethers.formatEther(nativeFee)} BNB`);
    logger.info(`Total: ${ethers.formatEther(totalNeeded)} BNB`);

    const minAmountLD = (amountToSend * 98n) / 100n; // 2% slippage

    const swapTx = await stargateRouter.swapETH(
        dstChainId,
        bscWallet.address, // refund address
        toAddressBytes,
        amountToSend,
        minAmountLD,
        { value: amountToSend + nativeFee }
    );

    logger.info(`Bridge tx: ${swapTx.hash}`);
    logger.info('Waiting for confirmation...');

    const receipt = await swapTx.wait();
    logger.info(`✅ Transaction confirmed in block ${receipt?.blockNumber}`);
    logger.info('Bridge will take 10-20 minutes to complete on Arbitrum');
    logger.info('You will receive ETH on Arbitrum!');
    logger.info('='.repeat(80));
}

main().catch(error => {
    logger.error('Bridge failed:', error);
    process.exit(1);
});

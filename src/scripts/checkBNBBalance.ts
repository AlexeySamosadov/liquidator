/**
 * Check BNB Chain wallet balance
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    // BNB Chain RPC
    const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        logger.error('PRIVATE_KEY not found');
        process.exit(1);
    }

    const wallet = new ethers.Wallet(privateKey, provider);

    logger.info('='.repeat(80));
    logger.info('BNB Chain Wallet Balance');
    logger.info('='.repeat(80));
    logger.info(`Wallet: ${wallet.address}`);

    // Get BNB balance
    const balance = await provider.getBalance(wallet.address);
    logger.info(`BNB Balance: ${ethers.formatEther(balance)} BNB`);

    // Check USDT balance (BEP20 USDT on BSC)
    const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
    const usdtAbi = [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)'
    ];
    const usdt = new ethers.Contract(usdtAddress, usdtAbi, provider);

    try {
        const usdtBalance = await usdt.balanceOf(wallet.address);
        logger.info(`USDT Balance: ${ethers.formatUnits(usdtBalance, 18)} USDT`);
    } catch (e) {
        logger.error('Failed to get USDT balance', e);
    }

    // Check BUSD balance
    const busdAddress = '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56';
    const busd = new ethers.Contract(busdAddress, usdtAbi, provider);

    try {
        const busdBalance = await busd.balanceOf(wallet.address);
        logger.info(`BUSD Balance: ${ethers.formatUnits(busdBalance, 18)} BUSD`);
    } catch (e) {
        logger.error('Failed to get BUSD balance', e);
    }

    logger.info('='.repeat(80));
}

main().catch(error => {
    logger.error('Error:', error);
    process.exit(1);
});

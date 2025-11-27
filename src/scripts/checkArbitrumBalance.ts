/**
 * Check Arbitrum wallet balance
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

    // Arbitrum RPC
    const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
    const wallet = new ethers.Wallet(privateKey, provider);

    logger.info('='.repeat(80));
    logger.info('Arbitrum Wallet Balance');
    logger.info('='.repeat(80));
    logger.info(`Wallet: ${wallet.address}`);

    // Get ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    logger.info(`ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

    // Check all stablecoin balances
    const tokenAbi = [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)'
    ];

    const stablecoins = [
        { name: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' },
        { name: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
        { name: 'USDC.e (Bridged)', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' },
        { name: 'DAI', address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1' }
    ];

    for (const token of stablecoins) {
        try {
            const contract = new ethers.Contract(token.address, tokenAbi, provider);
            const balance = await contract.balanceOf(wallet.address);
            const decimals = await contract.decimals();
            const formatted = ethers.formatUnits(balance, decimals);
            if (balance > 0n) {
                logger.info(`${token.name} Balance: ${formatted}`);
            }
        } catch (e) {
            // Skip if error
        }
    }

    logger.info('='.repeat(80));
}

main().catch(error => {
    logger.error('Error:', error);
    process.exit(1);
});

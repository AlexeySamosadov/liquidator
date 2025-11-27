import { ethers } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMXAddresses } from '../types';
import * as dotenv from 'dotenv';

dotenv.config();

// Target details from user question
const TARGET_ACCOUNT = '0x16Fd4F9B706915A52323281293527D1612932924'; // Found from previous logs or user description
// We need to find the exact market for this account. 
// Since we don't have it handy, we'll scan the account's positions.

const GMX_ARBITRUM_ADDRESSES: GMXAddresses = {
    reader: '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E',
    dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    exchangeRouter: '0x7C68C7866A64FA2160F78EEaE1209B9F3A8d79ab',
    marketFactory: '0x0000000000000000000000000000000000000000',
    depositVault: '0x0000000000000000000000000000000000000000'
};

async function analyzePosition() {
    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);

    console.log(`🔍 Analyzing positions for account: ${TARGET_ACCOUNT}`);

    // 1. Get all position keys for the account
    // We'll use the DataStore directly as GMXContracts helper might not be enough

    // We need to find the position key. 
    // Since we don't know the market/collateral/isLong, we have to iterate or find it from our previous logs.
    // Let's assume we can find it by scanning verified positions file if it exists, 
    // or better, let's just use the Reader to get all positions if possible.
    // Reader doesn't have "getAllPositionsForAccount".

    // Let's look at the "verified positions" file we created earlier, it might have the full details.
    const fs = require('fs');
    const path = require('path');
    const verifiedPath = path.join(__dirname, '../../data/gmx_small_liquidation_targets.json');

    if (!fs.existsSync(verifiedPath)) {
        console.error('Targets file not found!');
        return;
    }

    const targets = JSON.parse(fs.readFileSync(verifiedPath, 'utf-8'));
    const target = targets.find((t: any) => t.account.toLowerCase() === TARGET_ACCOUNT.toLowerCase());

    if (!target) {
        console.error('Target not found in small targets list. Trying to find partial match...');
        const partial = targets.find((t: any) => t.account.toLowerCase().startsWith('0x16fd4f9b'));
        if (partial) {
            console.log('Found partial match:', partial.account);
            analyzeSpecificPosition(provider, gmxContracts, partial);
        } else {
            console.log('No match found.');
        }
        return;
    }

    await analyzeSpecificPosition(provider, gmxContracts, target);
}

async function analyzeSpecificPosition(provider: any, gmxContracts: any, target: any) {
    const reader = gmxContracts.getReader();
    const dataStore = gmxContracts.getDataStoreAddress();

    console.log(`\n📊 Position Details:`);
    console.log(`Market: ${target.market}`);
    console.log(`Collateral Token: ${target.collateralToken}`);
    console.log(`Is Long: ${target.isLong}`);

    // 1. Fetch Market Info
    const marketInfo = await reader.getMarket(dataStore, target.market);
    const indexToken = marketInfo.indexToken;

    // 2. Fetch Prices (We need real-time prices to calculate PnL)
    // We can use the GMX Oracle or just Chainlink/RPC for estimation.
    // For accuracy, let's try to read from the Reader's getMarketTokenPrice if possible, 
    // but Reader.isPositionLiquidatable requires a complex Price struct.

    // Let's cheat slightly and use the "Position Health" logic we already have in HybridGMXMonitor
    // Or just manually calculate PnL if we can get the entry price.

    // Get Position Info from Reader
    const positionKey = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address', 'address', 'bool'],
            [target.account, target.market, target.collateralToken, target.isLong]
        )
    );

    // We need to read specific fields from DataStore because Reader.getPosition is not always simple
    const ds = gmxContracts.getDataStore();

    // Keys
    const sizeInUsdKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_SIZE_IN_USD'), ethers.getBytes(positionKey)]));
    const sizeInTokensKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_SIZE_IN_TOKENS'), ethers.getBytes(positionKey)]));
    const collateralAmountKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_COLLATERAL_AMOUNT'), ethers.getBytes(positionKey)]));
    // Note: GMX V2 tracks borrowing fees etc, entry price is derived or stored differently? 
    // Actually GMX V2 uses "increasedAtBlock" and tracks cost basis. 
    // Let's look for "borrowing factor" or just use the simple size/collateral for now.

    const sizeInUsd = await ds.getUint(sizeInUsdKey);
    const collateralAmount = await ds.getUint(collateralAmountKey);
    const sizeInTokens = await ds.getUint(sizeInTokensKey);

    console.log('--- Raw DataStore Values ---');
    console.log(`Size In USD: ${sizeInUsd.toString()}`);
    console.log(`Collateral Amount: ${collateralAmount.toString()}`);
    console.log(`Size In Tokens: ${sizeInTokens.toString()}`);
    console.log('----------------------------');

    if (sizeInUsd === 0n) {
        console.error('❌ Position appears to be closed or keys are incorrect.');
        return;
    }

    // To get PnL, we need current price vs entry price.
    // Entry Price = Size In USD / Size In Tokens (roughly)
    const sizeUsdNum = Number(ethers.formatUnits(sizeInUsd, 30));

    // Check token decimals
    let decimals = 18;
    let symbol = 'UNKNOWN';

    try {
        const erc20Abi = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'];
        const indexTokenContract = new ethers.Contract(indexToken, erc20Abi, provider);

        // Hardcode for common tokens to avoid RPC issues
        if (indexToken.toLowerCase() === '0x82af49447d8a07e3bd95bd0d56f35241523fbab1') { // WETH
            decimals = 18;
            symbol = 'WETH';
        } else if (indexToken.toLowerCase() === '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f') { // WBTC
            decimals = 8;
            symbol = 'WBTC';
        } else if (indexToken.toLowerCase() === '0xaf88d065e77c8cc2239327c5edb3a432268e5831') { // USDC
            decimals = 6;
            symbol = 'USDC';
        } else if (indexToken.toLowerCase() === '0x912ce59144191c1204e64559fe8253a0e49e6548') { // ARB
            decimals = 18;
            symbol = 'ARB';
        } else {
            decimals = Number(await indexTokenContract.decimals());
            symbol = await indexTokenContract.symbol();
        }
    } catch (e) {
        console.warn('Failed to fetch token details, defaulting to 18 decimals');
    }

    const entryPrice = sizeUsdNum / Number(ethers.formatUnits(sizeInTokens, decimals));

    console.log(`\nAsset: ${symbol}`);
    console.log(`Entry Price: $${entryPrice.toFixed(2)}`);

    // Get Current Price (using a simple public aggregator or just assuming we can get it from GMX Oracle)
    // Let's use a public RPC call to Chainlink or just fetch from an API for display purposes?
    // Or better, use the GMX Reader to get prices if we can construct the call.

    // Let's use a simple fetch to Binance/CoinGecko API for "approximate" current price to show the user
    // This is faster than setting up the complex GMX Oracle read for a one-off script.
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
    const data = await response.json() as any;
    const currentPrice = parseFloat(data.price);

    console.log(`Current Price: $${currentPrice.toFixed(2)}`);

    // Calculate PnL
    let pnl = 0;
    if (target.isLong) {
        pnl = (currentPrice - entryPrice) * Number(ethers.formatUnits(sizeInTokens, decimals));
    } else {
        pnl = (entryPrice - currentPrice) * Number(ethers.formatUnits(sizeInTokens, decimals));
    }

    const collateralUsd = Number(ethers.formatUnits(collateralAmount, 6)); // Assuming USDC collateral
    const remainingCollateral = collateralUsd + pnl;
    const pnlPercent = (pnl / collateralUsd) * 100;

    console.log(`\n💰 Financials:`);
    console.log(`Initial Collateral: $${collateralUsd.toFixed(2)}`);
    console.log(`PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
    console.log(`Remaining Collateral: $${remainingCollateral.toFixed(2)}`);

    // Liquidation Distance
    // Liquidation happens when Remaining Collateral < Size * LiquidationFactor (usually 1-2%)
    // Or roughly when Remaining Collateral hits 0.

    const liquidationThreshold = sizeUsdNum * 0.01; // 1% margin requirement roughly
    const distanceToLiq = remainingCollateral - liquidationThreshold;
    const priceMoveForLiq = (distanceToLiq / sizeUsdNum) * 100; // % move needed

    console.log(`\n⚠️ Liquidation Risk:`);
    console.log(`Liquidation Threshold: ~$${liquidationThreshold.toFixed(2)} (Collateral needed to survive)`);
    console.log(`Distance to Liquidation: $${distanceToLiq.toFixed(2)}`);

    if (distanceToLiq <= 0) {
        console.log(`🚨 STATUS: LIQUIDATABLE NOW!`);
    } else {
        console.log(`Safe by: ${priceMoveForLiq.toFixed(2)}% price move`);

        // Calculate Liquidation Price
        // Long: LiqPrice = EntryPrice * (1 - (Collateral - Threshold) / Size)
        // Short: LiqPrice = EntryPrice * (1 + (Collateral - Threshold) / Size)

        let liqPrice = 0;
        if (target.isLong) {
            liqPrice = entryPrice * (1 - (collateralUsd - liquidationThreshold) / sizeUsdNum);
        } else {
            liqPrice = entryPrice * (1 + (collateralUsd - liquidationThreshold) / sizeUsdNum);
        }
        console.log(`Estimated Liq Price: $${liqPrice.toFixed(2)}`);
    }
}

analyzePosition().catch(console.error);

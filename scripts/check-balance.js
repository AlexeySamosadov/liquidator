#!/usr/bin/env node
// Проверяет балансы BNB и стейблкоинов для кошелька бота
require('dotenv').config();

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const colors = {
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
};

const STABLES = [
  { address: '0x55d398326f99059fF775485246999027B3197955', label: 'USDT' },
  { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', label: 'BUSD' },
];

const formatUsd = (value) => `${value.toFixed(2)} USD`;

const printError = (message) => {
  console.error(colors.red(`❌ ${message}`));
  process.exit(1);
};

(function validateEnv() {
  const requiredString = (name, value) => {
    if (!value) {
      throw new Error(`Missing required env: ${name}`);
    }
    return value;
  };

  const parseNumber = (name, value, defaultValue) => {
    if (value === undefined || value === '') return defaultValue;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`Env ${name} must be a valid number`);
    }
    return parsed;
  };

  const parseBoolean = (value, defaultValue) => {
    if (value === undefined || value === '') return defaultValue;
    return value.toLowerCase() === 'true';
  };

  const validatePrivateKey = (pk) => {
    const hexRegex = /^[0-9a-fA-F]{64}$/;
    if (!hexRegex.test(pk)) {
      throw new Error('PRIVATE_KEY must be 64 hex characters without 0x prefix');
    }
  };

  try {
    const rpcUrl = requiredString('RPC_URL', process.env.RPC_URL);
    const chainId = parseNumber('CHAIN_ID', process.env.CHAIN_ID, 56);
    const privateKey = requiredString('PRIVATE_KEY', process.env.PRIVATE_KEY);
    const useFlashLoans = parseBoolean(process.env.USE_FLASH_LOANS, false);
    validatePrivateKey(privateKey);

    process.env.CHECK_BALANCE_RPC_URL = rpcUrl;
    process.env.CHECK_BALANCE_CHAIN_ID = String(chainId);
    process.env.CHECK_BALANCE_PRIVATE_KEY = privateKey;
    process.env.CHECK_BALANCE_USE_FLASH_LOANS = String(useFlashLoans);
  } catch (error) {
    printError(error.message || error);
  }
})();

(async () => {
  const { JsonRpcProvider, Wallet, Contract, formatEther, formatUnits } = await import('ethers');

  const config = {
    rpcUrl: process.env.CHECK_BALANCE_RPC_URL,
    chainId: Number(process.env.CHECK_BALANCE_CHAIN_ID),
    privateKey: process.env.CHECK_BALANCE_PRIVATE_KEY,
    useFlashLoans: process.env.CHECK_BALANCE_USE_FLASH_LOANS === 'true',
  };

  console.log(colors.bold('🔌 Проверка подключения к RPC...'));
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);

  try {
    const block = await provider.getBlockNumber();
    console.log(colors.green(`✅ RPC доступен, текущий блок: ${block}`));
  } catch (error) {
    printError(`Не удалось подключиться к RPC: ${error.message || error}`);
  }

  const wallet = new Wallet(`0x${config.privateKey}`, provider);
  console.log(colors.bold(`\n👛 Кошелек: ${wallet.address}`));

  try {
    const balance = await provider.getBalance(wallet.address);
    const bnb = Number(formatEther(balance));
    const bnbLine = `${bnb.toFixed(5)} BNB`;
    const bnbStatus = bnb >= 0.05 ? colors.green('OK') : colors.red('LOW');
    console.log(`BNB баланс: ${bnbLine} [минимум 0.05] -> ${bnbStatus}`);

    console.log('\n💵 Стейблкоины:');
    let stableTotal = 0;
    for (const token of STABLES) {
      const contract = new Contract(token.address, ERC20_ABI, provider);
      const [decimals, symbol, rawBalance] = await Promise.all([
        contract.decimals(),
        contract.symbol(),
        contract.balanceOf(wallet.address),
      ]);
      const humanBalance = Number(formatUnits(rawBalance, decimals));
      stableTotal += humanBalance;
      const status = humanBalance >= 1 ? colors.green('•') : colors.yellow('•');
      console.log(`${status} ${symbol || token.label}: ${humanBalance.toFixed(2)} (${formatUsd(humanBalance)})`);
    }

    const enoughStables = config.useFlashLoans ? true : stableTotal >= 500;
    const stableMsg = config.useFlashLoans
      ? 'Flash loans включены, стейблкоины не обязательны'
      : `Суммарно: ${formatUsd(stableTotal)} (требуется ≥ 500 USD)`;
    const stableStatus = enoughStables ? colors.green('OK') : colors.red('LOW');
    console.log(`Итог по стейблкоинам: ${stableMsg} -> ${stableStatus}`);

    console.log('\n⚙️  Итоговая готовность:');
    const ready = bnb >= 0.05 && enoughStables;
    if (ready) {
      console.log(colors.green('✅ Достаточно средств для запуска бота.'));
    } else {
      console.log(colors.red('❗ Пополните кошелек: нужен BNB ≥ 0.05 и стейблкоины ≥ 500 USD (если flash loans выключены).'));
    }
  } catch (error) {
    printError(error.message || error);
  }
})();

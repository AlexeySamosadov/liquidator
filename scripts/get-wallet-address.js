#!/usr/bin/env node
// Выводит адрес кошелька из PRIVATE_KEY в .env
require('dotenv').config();

const errorExit = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

(async () => {
  const { Wallet } = await import('ethers');

  try {
    const rawPk = process.env.PRIVATE_KEY;
    if (!rawPk) {
      errorExit('Переменная PRIVATE_KEY не найдена. Скопируйте .env.example в .env и укажите приватный ключ (без 0x).');
    }

    const trimmed = rawPk.trim();
    const hexRegex = /^[0-9a-fA-F]{64}$/;
    if (trimmed.startsWith('0x')) {
      errorExit('PRIVATE_KEY должен быть без префикса 0x — удалите его в .env, чтобы ключ был ровно 64 hex-символа.');
    }
    if (!hexRegex.test(trimmed)) {
      errorExit('PRIVATE_KEY должен быть 64 hex-символа без префикса 0x.');
    }

    const wallet = new Wallet(`0x${trimmed}`);
    console.log('Адрес кошелька для пополнения:', wallet.address);
  } catch (error) {
    errorExit(error.message || error);
  }
})();

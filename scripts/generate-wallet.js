#!/usr/bin/env node
// Создает новый кошелек и выводит данные для .env

(async () => {
  const { Wallet } = await import('ethers');

  try {
    const wallet = Wallet.createRandom();
    const privateKeyNo0x = wallet.privateKey.startsWith('0x')
      ? wallet.privateKey.slice(2)
      : wallet.privateKey;

    console.log('✅ Новый кошелек создан\n');
    console.log('Адрес:', wallet.address);
    console.log('Приватный ключ (БЕЗ 0x):', privateKeyNo0x);

    if (wallet.mnemonic?.phrase) {
      console.log('Мнемоническая фраза (seed phrase):', wallet.mnemonic.phrase);
    } else {
      console.log('Мнемоническая фраза недоступна для этого кошелька.');
    }

    console.log('\n⚠️  Сохраните приватный ключ и мнемонику в безопасном месте.');
    console.log('⚠️  Никогда не делитесь этими данными и используйте кошелек только для бота.');
    console.log('➡️  Добавьте значение PRIVATE_KEY (без 0x) в файл .env.');
  } catch (error) {
    console.error('❌ Не удалось сгенерировать кошелек:', error.message || error);
    process.exit(1);
  }
})();

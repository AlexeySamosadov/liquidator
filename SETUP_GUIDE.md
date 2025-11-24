# Руководство по настройке бота

Подробные шаги для подключения к RPC, создания/импорта кошелька, пополнения и проверки интеграции ликвидационного бота Venus на BNB Chain.

## 1. Настройка RPC подключения
1. Скопируйте пример конфига: `cp .env.example .env`.
2. Откройте `.env` и укажите HTTP RPC endpoint (WebSocket не нужен):
   ```env
   RPC_URL=https://bsc-mainnet.nodereal.io/v1/ba3f9708c344476ab081a85fee975139
   CHAIN_ID=56
   ```
3. Убедитесь, что используете HTTP/HTTPS URL. `JsonRpcProvider` в `src/index.ts` не работает с `wss://` в текущей версии.

## 2. Создание и настройка кошелька

### Вариант А: Создать новый кошелек
```bash
node -e "import('ethers').then(({ Wallet }) => { const w = Wallet.createRandom(); const pk = w.privateKey.startsWith('0x') ? w.privateKey.slice(2) : w.privateKey; console.log('Address:', w.address); console.log('Private Key (БЕЗ 0x):', pk); });"
```
Сохраните приватный ключ и фразу в надежном месте и добавьте ключ БЕЗ `0x` в `.env`:
```env
PRIVATE_KEY=<ваш_ключ_без_0x>
```

### Вариант Б: Импорт существующего кошелька
1. Экспортируйте приватный ключ из MetaMask/другого кошелька.
2. Удалите префикс `0x`, если он есть.
3. Поместите в `.env` переменную `PRIVATE_KEY`.
4. Ключ с префиксом `0x` будет отклонен скриптами и ботом — в `.env` должно быть ровно 64 hex символа без префикса.
5. Используйте отдельный кошелек только для бота.

## 3. Получение адреса кошелька для пополнения

**Способ 1 — скрипт**
```bash
node scripts/get-wallet-address.js
```
Выведет строку `Адрес кошелька для пополнения: 0x...`.

**Способ 2 — запуск бота**
```bash
npm run dev
```
В логах найдите `Wallet initialized` и адрес. Остановите процесс (`Ctrl+C`).

## 4. Пополнение кошелька

**BNB для газа**
- Минимум: 0.05 BNB (~$30 при цене $600/BNB)
- Рекомендуется: 0.1–0.2 BNB
- Назначение: комиссии за ликвидации (газ ~$0.02–0.10)

**Стейблкоины для ликвидаций (если `USE_FLASH_LOANS=false`)**
- Рекомендуемая сумма: $500–1000 в USDT или BUSD
- USDT: `0x55d398326f99059fF775485246999027B3197955`
- BUSD: `0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56`
- При `USE_FLASH_LOANS=true` стейблы не требуются, нужен только BNB на газ.

**Как пополнить**
- Отправьте BNB и стейблкоины на адрес кошелька из шага 3.
- Лучше выводить с CEX (Binance, OKX и др.) сразу в сети BNB Chain.
- Или использовать мост, выбрав сеть BNB Chain (BSC).

## 5. Настройка параметров бота (.env)

**Для теста (без рисков):**
```env
DRY_RUN=true
MIN_PROFIT_USD=5
MAX_POSITION_SIZE_USD=100
MAX_DAILY_LOSS_USD=20
USE_FLASH_LOANS=false
COLLATERAL_STRATEGY=HOLD
```

**Для продакшн (после тестов):**
```env
DRY_RUN=false
MIN_PROFIT_USD=10
MAX_POSITION_SIZE_USD=1000
MAX_DAILY_LOSS_USD=50
USE_FLASH_LOANS=false
COLLATERAL_STRATEGY=AUTO_SELL
PREFERRED_STABLECOIN=0x55d398326f99059fF775485246999027B3197955
```

## 6. Проверка интеграции
1. Установите зависимости: `npm install`.
2. Сборка и dry-run: 
   ```bash
   npm run build
   npm start
   ```
3. В логах проверьте:
   - `RPC connected to BNB Chain` + номер блока — RPC работает
   - `Wallet initialized` + баланс — кошелек создан
   - `Found Venus markets` — подключение к Venus
   - `Liquidation bonus` — параметры протокола
   - `Monitoring service started` — мониторинг запущен
   - `Execution service started` — движок готов
   - `Periodic stats report` — периодическая статистика
4. Балансы: найдите строку `Wallet initialized` и убедитесь, что BNB > 0.05. Стейблы можно проверить на BSCScan по адресу кошелька.
5. Оставьте бота в `DRY_RUN=true` на 10–15 минут и убедитесь, что ошибки отсутствуют; потенциальные сделки будут помечены `[DRY RUN]`.
6. Для боевого режима установите `DRY_RUN=false` и перезапустите: `npm start`.

## 7. Мониторинг работы
- Логи в консоли и при `LOG_TO_FILE=true` в `./logs`.
- Каждую минуту — сводка по мониторингу/исполнению.
- Суточная статистика в `./daily_stats.json`, сбрасывается в 00:00 UTC; при превышении `MAX_DAILY_LOSS_USD` бот останавливается.
- Аварийная остановка: создайте файл `./emergency_stop.flag`; удалите его для возобновления.

## 8. Устранение проблем
- `Missing required env: RPC_URL` — создайте `.env` и задайте `RPC_URL`.
- `PRIVATE_KEY must be 64 hex characters` — укажите ключ без `0x`, ровно 64 hex символа.
- Ошибка RPC — проверьте URL/токен, откройте его в браузере для проверки JSON-RPC ответа.
- Низкий баланс BNB — пополните > 0.05 BNB.
- Нет ликвидируемых позиций — это нормально; снизьте `MIN_PROFIT_USD` для теста или ждите новых возможностей.

## 9. Рекомендации по безопасности
- Никогда не коммитьте `.env`.
- Используйте отдельный кошелек только для бота.
- Начинайте с малых сумм ($100–200) и повышайте постепенно.
- Регулярно выводите прибыль.
- Следите за логами и лимитом `MAX_DAILY_LOSS_USD`.
- Тестируйте изменения только в режиме `DRY_RUN=true`.

## 10. Полезные ссылки
- BSCScan: https://bscscan.com
- Venus Protocol: https://app.venus.io
- PancakeSwap: https://pancakeswap.finance
- NodeReal RPC: https://docs.nodereal.io

Готово! После выполнения шагов бот полностью настроен и готов к запуску на BNB Chain.

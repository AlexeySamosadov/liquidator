# Venus Liquidation Bot 🚀

Автоматический бот для ликвидации позиций на Venus Protocol (BNB Chain) с гибридной стратегией: использование собственного капитала + flash loans от PancakeSwap.

## Особенности
- ✅ Гибридная стратегия (капитал + flash loans)
- ✅ Комбинированный мониторинг (polling + events)
- ✅ Настраиваемая стратегия управления залогом
- ✅ Низкие комиссии (газ ~$0.02-0.10)
- ✅ Высокая доходность (8-12.5% liquidation bonus)
- ✅ Оптимизирован для начального капитала $500-1000
- ✅ Автоматическая продажа залога в стейблкоины (PancakeSwap V3)
- ✅ Защита от проскальзывания (2-3%) и price impact
- ✅ Мультихоп роутинг для оптимальных свопов

## Требования
- Node.js >= 18.0.0
- BNB для оплаты газа (~$10-20 для начала)
- Стейблкоины (USDT/BUSD) для ликвидаций ($500-1000)
- RPC endpoint для BNB Chain

## Установка
```bash
npm install
cp .env.example .env
# Отредактировать .env файл
```

## Быстрый старт
1. Установите зависимости: `npm install`.
2. Скопируйте `.env.example` в `.env`.
3. Укажите RPC URL (пример NodeReal): `RPC_URL=https://bsc-mainnet.nodereal.io/v1/ba3f9708c344476ab081a85fee975139`.
4. Создайте/импортируйте кошелек: `npm run wallet:generate` или вставьте приватный ключ в `.env` (без `0x`). Ключ с префиксом `0x` будет отклонен скриптами и ботом — оставьте ровно 64 hex символа.
5. Узнайте адрес для пополнения: `npm run wallet:address`.
6. Пополните кошелек BNB (газ) + стейблкоины (USDT/BUSD) при `USE_FLASH_LOANS=false`.
7. Проверьте готовность балансов: `npm run wallet:balance`.
   Скрипту нужны только `RPC_URL`, `CHAIN_ID` (по умолчанию 56), `PRIVATE_KEY` (без `0x`) и `USE_FLASH_LOANS`; остальные переменные `.env` не обязательны.
8. Тестовый запуск: `DRY_RUN=true` в `.env`, затем `npm run build && npm start`.
9. Боевой запуск: установите `DRY_RUN=false` и перезапустите `npm start`.

📖 Для подробной инструкции по настройке см. [SETUP_GUIDE.md](SETUP_GUIDE.md).

## Конфигурация
Основные параметры (.env):
- `RPC_URL` — RPC endpoint BNB Chain
- `PRIVATE_KEY` — приватный ключ кошелька (без 0x, ровно 64 hex символа)
- `MIN_PROFIT_USD` — минимальная прибыль для запуска ликвидации
- `MAX_POSITION_SIZE_USD` — максимальный размер позиции для ликвидации
- `GAS_PRICE_MULTIPLIER` — множитель цены газа (например, 1.2)
- `MAX_GAS_PRICE_GWEI` — потолок цены газа в Gwei
- `TOKEN_BLACKLIST` — адреса токенов, которые никогда не ликвидировать
- `TOKEN_WHITELIST` — если задан, ликвидировать только эти токены (перекрывает blacklist)
- `MAX_DAILY_LOSS_USD` — предел дневного убытка до авто-паузы
- `EMERGENCY_STOP_FILE` — путь к файлу-флагу аварийной остановки
- `DRY_RUN` — режим симуляции без отправки транзакций
- `USE_FLASH_LOANS` — использовать ли flash loans
- `FLASH_LOAN_FEE_BPS` — комиссия flash‑loan в базисных пунктах (500 = 0.05%)
- `FLASH_LIQUIDATOR_CONTRACT` — адрес развернутого flash‑liq контракта (опционально)
- `COLLATERAL_STRATEGY` — AUTO_SELL | HOLD | CONFIGURABLE
- `SLIPPAGE_TOLERANCE` — допустимый slippage (0.02 = 2%)
- `MIN_SWAP_AMOUNT_USD` — минимальная сумма для свопа
- `MAX_PRICE_IMPACT` — максимальное отклонение цены oracle vs DEX в долях (0.03 = 3%)
- `PREFERRED_STABLECOIN` — адрес стейблкоина для AUTO_SELL
- `LOG_LEVEL` — уровень логирования
- `LOG_TO_FILE` — писать ли логи в файлы
- `PANCAKESWAP_V3_FACTORY` — фабрика PancakeSwap V3 (для flash‑loan)

### Risk Management

The bot includes comprehensive risk controls to protect your capital:

#### Token Filtering
- `TOKEN_BLACKLIST`: Comma-separated addresses to never liquidate (e.g., suspicious tokens)
- `TOKEN_WHITELIST`: If set, ONLY liquidate these tokens (overrides blacklist)

#### Daily Loss Limits
- `MAX_DAILY_LOSS_USD`: Maximum acceptable daily loss (default: $50)
- Bot auto-pauses when limit is exceeded
- Stats reset daily at midnight UTC
- View stats in `./daily_stats.json`

#### Emergency Stop
- Create `./emergency_stop.flag` file to manually pause the bot
- Bot checks this file before each liquidation
- Auto-activates on daily loss limit breach
- Delete file to resume operations

#### Simulation Mode
- `DRY_RUN=true`: Test bot logic without sending real transactions
- Logs all intended actions with `[DRY RUN]` prefix
- Perfect for testing configuration changes safely
- Gas is still estimated but not consumed

#### Pre-Execution Checks
Before each liquidation, the bot validates:
1. Emergency stop status
2. Daily loss limits
3. Gas price within acceptable range
4. Token not blacklisted/whitelisted
5. Sufficient wallet balance (standard mode)
6. Health factor still < 1.0 (position still liquidatable)
7. Position size within configured limits

Any failed check prevents execution and logs the reason.

#### Pause/Resume Semantics
- `pause()` keeps retry/backoff/cooldown state intact; when you call `resume()` the bot continues honoring existing delays.
- Use `stop()`/`start()` (or restart the process) if you need a clean slate without previous retry history.

## Запуск
```bash
npm run build
npm start
```

## Development
```bash
npm run dev
```

## Testing

Проект использует Jest для тестирования. Тесты организованы в три категории:

### Структура тестов

- `tests/unit/` - Unit тесты для отдельных классов и функций
- `tests/integration/` - Интеграционные тесты для взаимодействия компонентов
- `tests/e2e/` - End-to-end тесты полного цикла работы бота
- `tests/mocks/` - Mock контракты и объекты
- `tests/utils/` - Test utilities и helper functions

### Запуск тестов

```bash
# Запустить все тесты
npm test

# Запустить только unit тесты
npm run test:unit

# Запустить только integration тесты
npm run test:integration

# Запустить только e2e тесты
npm run test:e2e

# Запустить тесты в watch режиме
npm run test:watch

# Запустить тесты с coverage
npm run test:coverage

# Запустить тесты с подробным выводом
npm run test:verbose
```

### Написание тестов

Используйте test utilities из `tests/utils/` для создания моков и тестовых данных:

```typescript
import { createFullMockEnvironment, createLiquidatablePosition } from '../utils';

const mockEnv = createFullMockEnvironment();
const position = createLiquidatablePosition();
```

Примеры тестов см. в `tests/unit/example.test.ts`.

### Testing Liquidators

Комплексные unit-тесты для StandardLiquidator и FlashLoanLiquidator:

```bash
# Все тесты ликвидаторов
npm run test:liquidators

# Watch режим
npm run test:liquidators:watch

# С coverage
npm run test:liquidators:coverage
```

**Структура тестов:**
- `tests/unit/StandardLiquidator.test.ts` - тесты для стандартной ликвидации
  - Проверка баланса (нативный/ERC20)
  - Approve токенов
  - Выполнение liquidateBorrow
  - Обработка ошибок
  - Edge cases

- `tests/unit/FlashLoanLiquidator.test.ts` - тесты для flash loan ликвидации
  - Поиск пула (counterparties, fee tiers)
  - Подготовка параметров flash loan
  - Выполнение через контракт
  - Обработка отсутствия контракта
  - Обработка ошибок
  - Edge cases

- `tests/unit/liquidators-integration.test.ts` - интеграционные тесты
  - Сравнение StandardLiquidator vs FlashLoanLiquidator
  - Обработка ошибок
  - Gas параметры
  - Real-world сценарии

**Моки:**
- `MockERC20` - ERC20 контракт (balance, allowance, approve, transfer)
- `MockVenusContracts` - wrapper для Venus контрактов
- Существующие моки: MockVToken, MockSigner, MockProvider, MockPancakeFactory, MockPancakePool, MockLiquidator

**Coverage цель:** >90% для StandardLiquidator и FlashLoanLiquidator

## Структура проекта
- `src/config` — загрузка/валидация конфигурации, адреса протоколов
- `src/contracts` — ABI и обертки для контрактов Venus/PancakeSwap
- `src/services` — сервисы мониторинга, ликвидации, управления залогом
- `src/services/dex` — свопы, проверка ценового воздействия, роутинг, управление залогом
- `src/utils` — логгер, утилиты чисел/цен, retry и валидации
- `src/types` — общие типы и интерфейсы

## Управление залогом
После успешной ликвидации бот может автоматически обменять полученный залог:

### Стратегии:
- **AUTO_SELL** — автоматически продает все токены в USDT/BUSD
- **HOLD** — сохраняет токены в кошельке
- **CONFIGURABLE** — использует правила для каждого токена (см. `src/config/tokens.ts`)

### Параметры безопасности:
- `SLIPPAGE_TOLERANCE` — максимальное проскальзывание (по умолчанию 2%)
- `MAX_PRICE_IMPACT` — максимально допустимое отклонение цены oracle vs DEX в долях (по умолчанию 0.03 = 3%)
- `MIN_SWAP_AMOUNT_USD` — минимальная сумма для свопа (пропуск пыли)

### Роутинг:
Бот автоматически находит оптимальный путь через PancakeSwap V3:
- Прямой своп (если есть ликвидность)
- Через WBNB (самая высокая ликвидность)
- Через USDT (для экзотических токенов)

## Liquidation Strategies
- Гибридный подход: стандартные ликвидации для небольших позиций, flash‑loans для крупных или при нехватке баланса.
- Выбор режима строится на сравнении доступного баланса и ожидаемой прибыли (учет газа и комиссии flash‑loan).
- Газ считается с множителем `GAS_PRICE_MULTIPLIER` и верхним пределом `MAX_GAS_PRICE_GWEI`.
- Результаты ликвидаций возвращают подробный `LiquidationResult` с метриками газа, бонуса и комиссии.

## Flash Loan Setup (Optional)
- Flash‑loan маршрут использует PancakeSwap V3 pool `flash()` и требует развернутого контракта‑ликвидатора.
- Переменная `FLASH_LIQUIDATOR_CONTRACT` может быть пустой — тогда бот работает только в стандартном режиме.
- `PANCAKESWAP_V3_FACTORY` и `FLASH_LOAN_FEE_BPS` задают фабрику пулов и комиссию (по умолчанию 0.05%).
- Контракт должен реализовывать `pancakeV3FlashCallback` и иметь запас BNB для оплаты газа.

## Testing Liquidations
- Начните с `USE_FLASH_LOANS=false` и маленьких позиций ($50–200) для проверки стандартных ликвидаций.
- Следите за логами: бот выводит баланс кошелька, найденные позиции и попытки ликвидации.
- Flash‑loan путь активируйте после деплоя контракта и заполнения `FLASH_LIQUIDATOR_CONTRACT`.
- Цикл автозапуска ликвидаций будет добавлен позже (Phase 6); сейчас движок инициализируется и готов к вызовам.

## Testing on Mainnet

1. **Start with dry-run mode:**
   ```bash
   DRY_RUN=true npm start
   ```
   Monitor logs to verify bot finds liquidatable positions.

2. **Enable with small limits:**
   ```env
   DRY_RUN=false
   MIN_PROFIT_USD=5
   MAX_POSITION_SIZE_USD=100
   MAX_DAILY_LOSS_USD=20
   ```

3. **Monitor daily stats:**
   ```bash
   cat daily_stats.json
   ```

4. **Emergency stop if needed:**
   ```bash
   touch emergency_stop.flag
   ```

## Архитектура
- MonitoringService → выявляет позиции (polling + events), отдает отсортированный список `LiquidatablePosition[]`.
- LiquidationEngine → выбирает стратегию, оценивает профит, строит транзакцию и вызывает Standard/Flash исполнители.
- ProfitabilityCalculator/TransactionBuilder → считают газ, комиссию flash‑loan и формируют параметры EIP-1559.
- StandardLiquidator → использует баланс кошелька для вызова `vToken.liquidateBorrow`.
- FlashLoanLiquidator → готов к PancakeSwap V3 flash‑loan (контракт можно развернуть позже).

## Безопасность
- ⚠️ Никогда не коммитить `.env` файл
- ⚠️ Использовать отдельный кошелек для бота
- ⚠️ Начинать с малых сумм для тестирования
- ⚠️ Проверяйте price impact перед крупными свопами
- ⚠️ Начинайте с HOLD стратегии для тестирования

## Лицензия
MIT

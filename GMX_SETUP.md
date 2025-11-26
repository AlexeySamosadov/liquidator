# 🔥 GMX V2 Liquidation Bot Setup (Arbitrum)

## Why GMX is Better Than Venus for Liquidations

| Feature | Venus (BSC) | **GMX V2 (Arbitrum)** |
|---------|-------------|----------------------|
| **Protocol Type** | Lending | **Perpetuals** 🎯 |
| **Leverage** | 1-2x | **Up to 100x** 🔥 |
| **TVL** | $200M | **$784M** (4x more!) |
| **Liquidation Frequency** | Rare (weekly) | **Constant** (hourly) |
| **Position Movement** | Need 30-60% price drop | **1-2% drop liquidates!** |
| **Gas Costs** | ~$0.10-0.30 | **~$0.01-0.05** |
| **Private TX** | ❌ No | **✅ bloXroute** |
| **Competition** | Low | Medium (but manageable with private TX) |
| **Profit per Liquidation** | $5-50 | **$10-500** |

### 🎯 Key Advantages:

1. **Constant Activity**: High-leverage traders open/close positions 24/7
2. **Easy to Liquidate**: 50x leverage = 2% price move = liquidation!
3. **Higher Profits**: Larger positions, more frequent liquidations
4. **MEV Protection**: bloXroute private orderflow = no frontrunning
5. **Low Gas**: Arbitrum gas ~10x cheaper than BSC

---

## 🚀 Quick Start

### 1. Copy Arbitrum Config

```bash
cp .env.arbitrum.example .env
```

### 2. Update Your NodeReal API Key

Edit `.env` and replace `YOUR_API_KEY`:

```bash
# Your NodeReal API key
RPC_URL=wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/
```

### 3. Add Your Private Key

```bash
PRIVATE_KEY=your_private_key_without_0x
```

### 4. Setup bloXroute Private TX (Highly Recommended!)

**Why bloXroute?** Protects your liquidations from MEV frontrunning.

Get API key from https://bloxroute.com

```bash
USE_PRIVATE_ORDERFLOW=true
BLOXROUTE_AUTH_HEADER=your_bloxroute_auth_header
PRIVATE_RPC_URL=https://arbitrum.blxrbdn.com
```

📖 **See [BLOXROUTE_SETUP.md](./BLOXROUTE_SETUP.md) for detailed setup guide**

### 5. Fund Your Wallet (Arbitrum)

```bash
# You need:
# - ETH for gas (~$10-20)
# - USDC for liquidations (~$100-1000)

# Bridge: https://bridge.arbitrum.io/
```

### 6. Test & Run GMX Bot

```bash
# Test GMX contract connection
npm run gmx:test

# Monitor GMX positions
npm run gmx:monitor
```

---

## 📊 GMX Liquidation Parameters

### When Does Liquidation Happen?

GMX liquidates when **position collateral < maintenance margin**:

```
Maintenance Margin = Position Size × (1 / Leverage) × Maintenance Factor
```

**Example:**
- Position: $10,000 LONG ETH
- Leverage: 50x
- Collateral: $200
- Entry Price: $2,000

**Liquidation Price:**
```
Liq Price = Entry × (1 - 1/Leverage × 0.99)
Liq Price = $2,000 × (1 - 1/50 × 0.99)
Liq Price ≈ $1,960 (2% drop!)
```

### Liquidation Incentive

GMX liquidators receive:
- **5% of position size** as reward
- Plus any remaining collateral after fees

**Example Profit:**
- Position Size: $10,000
- Your Reward: **$500** (5%)
- Gas Cost: ~$0.02
- **Net Profit: ~$499.98** 💰

---

## 🔄 Switch Between Venus & GMX

### Run Venus Bot (BSC)

```bash
# Use BSC config
cp .env.backup .env  # Your old Venus config
RPC_URL=wss://bsc-mainnet.nodereal.io/ws/v1/ba3f9708c344476ab081a85fee975139

# Run
npm run healthcare:monitor
```

### Run GMX Bot (Arbitrum)

```bash
# Use Arbitrum config
cp .env.arbitrum.example .env
RPC_URL=wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/

# Run
npm run gmx:monitor
```

### Run BOTH Simultaneously (Advanced)

```bash
# Terminal 1: Venus BSC
cp .env.bsc .env && npm run healthcare:monitor

# Terminal 2: GMX Arbitrum
cp .env.arbitrum .env && npm run gmx:monitor
```

---

## 📡 NodeReal Endpoints

Your API key works on all chains!

```bash
# BSC
https://bsc-mainnet.nodereal.io/v1/ba3f9708c344476ab081a85fee975139
wss://bsc-mainnet.nodereal.io/ws/v1/ba3f9708c344476ab081a85fee975139

# Arbitrum
https://open-platform.nodereal.io/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/
wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/arbitrum-nitro/

# Avalanche
https://open-platform.nodereal.io/ba3f9708c344476ab081a85fee975139/avalanche-c/ext/bc/C/rpc/
wss://open-platform.nodereal.io/ws/ba3f9708c344476ab081a85fee975139/avalanche-c/ext/bc/C/ws/
```

---

## 🛡️ Private Orderflow (bloXroute)

### Why Use Private TX?

Without private TX:
- ❌ Your liquidation goes to public mempool
- ❌ MEV bots see it and frontrun you
- ❌ You lose the liquidation reward

With bloXroute private TX:
- ✅ Direct to validator, skips mempool
- ✅ No frontrunning possible
- ✅ **You get the reward!**

### Setup bloXroute

1. Sign up: https://bloxroute.com/
2. Get Arbitrum gateway access
3. Add to `.env`:

```bash
USE_PRIVATE_ORDERFLOW=true
PRIVATE_RPC_URL=https://arbitrum.blxrbdn.com
BLOXROUTE_AUTH_HEADER=your_auth_header_here
```

---

## 🎯 Implementation Status

1. ✅ Multi-chain architecture (BSC + Arbitrum)
2. ✅ NodeReal WebSocket endpoints configured
3. ✅ GMX V2 contract ABIs (Reader, ExchangeRouter, DataStore)
4. ✅ GMX position monitoring service with health factor calculation
5. ✅ bloXroute private transaction integration
6. ✅ Liquidation execution engine
7. ⏳ Real-time event monitoring (PositionIncrease/Decrease)
8. ⏳ Chainlink Data Streams integration for accurate pricing
9. ⏳ Production testing on Arbitrum mainnet

**Infrastructure ready! Time to catch some liquidations!** 💰

## 📦 What's Implemented

### Core Services
- ✅ `GMXContracts` - Contract manager for Reader, DataStore, ExchangeRouter
- ✅ `GMXPositionCalculator` - Health factor, liquidation price, profit calculations
- ✅ `GMXPositionTracker` - Multi-position tracking with risk categories
- ✅ `GMXMonitoringService` - Automated position monitoring
- ✅ `GMXLiquidationExecutor` - Execute liquidations via bloXroute
- ✅ `PrivateTransactionService` - MEV-protected transaction submission

### NPM Scripts
```bash
npm run gmx:test      # Test GMX contract connectivity
npm run gmx:monitor   # Monitor GMX positions in real-time
```

---

## 📚 Resources

- [GMX V2 Docs](https://gmx.io)
- [GMX Contracts](https://gmxio.gitbook.io/gmx/contracts)
- [bloXroute Docs](https://docs.bloxroute.com/)
- [Arbitrum Bridge](https://bridge.arbitrum.io/)
- [NodeReal Arbitrum](https://nodereal.io/meganode/api-marketplace/arbitrum-one-archive)

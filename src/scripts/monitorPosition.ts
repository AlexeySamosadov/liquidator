import { ethers } from "ethers";
import { AaveV3Monitor } from "../services/aave/AaveV3Monitor";
import { AaveV3Executor } from "../services/aave/AaveV3Executor";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

// Logging setup
const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "liquidation-bot.log");
const EVENTS_FILE = path.join(LOG_DIR, "liquidation-events.log");

// Create logs directory
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(message: string, level: "INFO" | "WARN" | "ERROR" | "LIQUIDATION" = "INFO") {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    
    // Console output
    console.log(message);
    
    // File output
    fs.appendFileSync(LOG_FILE, logLine);
    
    // Special events log (liquidations, critical HF, errors)
    if (level === "LIQUIDATION" || level === "ERROR" || level === "WARN") {
        fs.appendFileSync(EVENTS_FILE, logLine);
    }
}

// Configuration
const ARBITRUM_RPC = process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc";
const ARBITRUM_WSS = process.env.ARBITRUM_WSS || "wss://arb1.arbitrum.io/ws"; // WebSocket
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const FLASH_LIQUIDATOR_ADDRESS = "0x9a55132AA9C800A81f73eB24C9732d52Aa3eced4";
const AUTO_EXECUTE_AUTO = (process.env.AUTO_EXECUTE_AUTO || "false").toLowerCase() === "true";

// Tokens on Arbitrum
const TOKENS = {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDCe: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    wstETH: "0x5979D7b546E38E414F7E9822514be443A4800529",
    LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
};

// Positions to watch (manual base set) + AUTO candidates from data/aave_candidates.json
// Updated 2025-11-27
interface WatchedPosition {
    user: string;
    name: string;
    debtToken: string;
    collateralToken: string;
    debtDecimals: number;
    poolFee: number;
    monitorOnly?: boolean; // if true, we will not execute liquidation automatically
}

function manualPositions(): WatchedPosition[] { return [
    // 🔴 CRITICAL - HF 1.004, closest to liquidation!
    {
        user: "0x006c6daf53ad20a2149560129062a5b4d7aea991",
        name: "#0 wstETH/WETH $2.7K HF:1.004 🔴",
        debtToken: TOKENS.WETH,
        collateralToken: TOKENS.wstETH,
        debtDecimals: 18,
        poolFee: 100, // 0.01% for correlated assets
    },
    // 🟡 HF ~1.05 - Volatile assets, high profit potential
    {
        user: "0x1889aaac3bde2ea77e4423b3d0d696ec53f821d3",
        name: "#1 $7.1K debt HF:1.049",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0xe5e58921dfa6602792e3f5624e91d291c01dc135",
        name: "#2 $11.4K debt HF:1.071",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0x4e4a22d6b195da0bef7a5b18bdef64c59104211f",
        name: "#3 $3.2K debt HF:1.076",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    // 🔵 HF ~1.08-1.09 - Large positions, big profit
    {
        user: "0xc3bc1a29c5feac0d852594c8a60348e9cbbb6021",
        name: "#4 $69.9K debt HF:1.083",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0x6732f7beec125720d90cc33a9ec628cbb909c192",
        name: "#5 $116K debt HF:1.085",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0x4218453f4ffaa2608580348628d588e1770d8417",
        name: "#6 $16.4K debt HF:1.085",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0x464b9107bd722f0dfe9277e79c27d234de84e042",
        name: "#7 $109K debt HF:1.089",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0xfa64ad195875e79b87cecd1a561982b51f93ca7f",
        name: "#8 $69.3K debt HF:1.088",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0x2e2cc0c1e2e27f2e8d87786c03dfa51dd1c3b34c",
        name: "#9 $42.4K debt HF:1.088",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0xc9e46942e544445c709d118e0a138dab70f9e4ce",
        name: "#10 $92K debt HF:1.092",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
]; }

// Dynamic watchlist (manual + auto)
let WATCHED_POSITIONS: WatchedPosition[] = [];

function buildWatchlist() {
    const manual = manualPositions();
    // Load top candidates from scanner outputs (big + small)
    const bigPath = path.join(process.cwd(), "data/aave_candidates_enriched.json");
    const smallPath = path.join(process.cwd(), "data/aave_candidates_small_enriched.json");
    let rows: Array<{user: string; hf?: number; debt?: number}> = [];
    try {
        const load = (p: string) => {
            if (!fs.existsSync(p)) return [] as any[];
            const raw = fs.readFileSync(p, "utf8");
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        };
        rows = [...load(bigPath), ...load(smallPath)].filter((x: any) => typeof x?.user === "string");
        // Sort by HF asc and pick top N
        rows.sort((a, b) => (Number(a.hf ?? 1e9) - Number(b.hf ?? 1e9)));
        rows = rows.slice(0, Number(process.env.WATCH_TOP || 50));
    } catch {}

    const auto: WatchedPosition[] = rows.map((r, idx) => ({
        user: r.user,
        name: `AUTO#${idx + 1} HF:${(r.hf ?? 0).toFixed?.(4) ?? r.hf} $${Math.round(r.debt ?? 0)}`,
        debtToken: (r as any).debtToken || TOKENS.USDC,
        collateralToken: (r as any).collToken || TOKENS.WETH,
        debtDecimals: Number((r as any).debtDecimals ?? 6),
        poolFee: Number((r as any).poolFee ?? 500),
        monitorOnly: !((r as any).debtToken && (r as any).collToken && (r as any).debtDecimals),
    }));

    // Deduplicate by user, manual takes precedence
    const map = new Map<string, WatchedPosition>();
    for (const p of [...manual, ...auto]) {
        if (!map.has(p.user)) map.set(p.user, p);
    }
    WATCHED_POSITIONS = Array.from(map.values());
}

interface PositionState {
    healthFactor: number;
    collateralUSD: number;
    debtUSD: number;
    timestamp: Date;
    blockNumber: number;
}

class PositionMonitor {
    private httpProvider: ethers.providers.JsonRpcProvider;
    private wsProvider: ethers.providers.WebSocketProvider | null = null;
    private monitor: AaveV3Monitor;
    private executor: AaveV3Executor;
    private positionHistory: Map<string, PositionState[]> = new Map();
    private isRunning = false;
    private lastDisplayTime = 0;
    private lastHF: Map<string, number> = new Map();
    private isLiquidating = false; // Prevent double liquidation
    private blocksChecked = 0;

    // Display interval (ms) - show status every 60 seconds for humans
    private readonly DISPLAY_INTERVAL = 60000;
    // Bot checks EVERY block (~250ms on Arbitrum)
    private readonly CHECK_INTERVAL = 250;

    constructor() {
        this.httpProvider = new ethers.providers.JsonRpcProvider(ARBITRUM_RPC);
        this.monitor = new AaveV3Monitor(ARBITRUM_RPC);
        this.executor = new AaveV3Executor(FLASH_LIQUIDATOR_ADDRESS, PRIVATE_KEY, ARBITRUM_RPC);
    }

    async start() {
        log("\n" + "=".repeat(60));
        log("🔴 REAL-TIME LIQUIDATION BOT");
        log("=".repeat(60));
        log(`Bot: ${this.executor.getWalletAddress()}`);
        buildWatchlist();
        log(`Contract: ${FLASH_LIQUIDATOR_ADDRESS}`);
        log(`Watching: ${WATCHED_POSITIONS.length} positions (manual+auto)`);
        log(`AUTO_EXECUTE_AUTO=${AUTO_EXECUTE_AUTO}`);
        log(`Log file: ${LOG_FILE}`);
        log(`Events file: ${EVENTS_FILE}`);
        log("=".repeat(60));
        log("\n⚡ BOT MODE: Checking EVERY block (~250ms)");
        log("📊 DISPLAY: Showing status every 10 seconds\n");

        this.isRunning = true;

        // Periodically reload watchlist (every 5 minutes)
        setInterval(() => {
            const prev = WATCHED_POSITIONS.length;
            buildWatchlist();
            if (WATCHED_POSITIONS.length !== prev) {
                log(`🔄 Watchlist reloaded: ${WATCHED_POSITIONS.length} positions`);
            }
        }, 5 * 60 * 1000);

        // Start fast polling for liquidation opportunities
        this.startFastBot();
    }

    /**
     * FAST BOT - checks every block for liquidation
     * This is the actual bot that executes liquidations in milliseconds
     */
    private async startFastBot() {
        log("🚀 Fast liquidation bot started!\n");
        
        let lastBlock = 0;

        while (this.isRunning) {
            try {
                const currentBlock = await this.httpProvider.getBlockNumber();
                
                // Only check if new block
                if (currentBlock > lastBlock) {
                    lastBlock = currentBlock;
                    this.blocksChecked++;
                    
                    // FAST CHECK - instant liquidation if opportunity found
                    await this.fastCheckAndLiquidate(currentBlock);
                }
            } catch (error: any) {
                // Silently ignore RPC errors, retry next iteration
            }

            // Small delay to not spam RPC (still very fast - 250ms)
            await this.sleep(this.CHECK_INTERVAL);
        }
    }

    /**
     * Fast check - ONLY checks HF and liquidates immediately if < 1.0
     * No logging here to maximize speed
     */
    private async fastCheckAndLiquidate(blockNumber: number) {
        const now = Date.now();
        const shouldDisplay = now - this.lastDisplayTime >= this.DISPLAY_INTERVAL;

        for (const pos of WATCHED_POSITIONS) {
            try {
                const accountData = await this.monitor.getUserAccountData(pos.user);
                const hf = Number(accountData.healthFactor) / 1e18;
                const debtUSD = Number(accountData.totalDebtBase) / 1e8;
                const collateralUSD = Number(accountData.totalCollateralBase) / 1e8;

                // Store for history
                this.lastHF.set(pos.user, hf);

                // 🔥 INSTANT LIQUIDATION CHECK - no delays!
                if (hf < 1.0 && !this.isLiquidating) {
                    const canExecute = AUTO_EXECUTE_AUTO || !pos.monitorOnly;
                    this.isLiquidating = true;
                    if (!canExecute) {
                        log(`\n⚡ [${new Date().toISOString()}] HF=${hf.toFixed(6)} < 1.0 DETECTED (monitor-only): ${pos.user}`, "LIQUIDATION");
                    } else {
                        log(`\n⚡ [${new Date().toISOString()}] HF=${hf.toFixed(6)} < 1.0 DETECTED! ${pos.name}`, "LIQUIDATION");
                        await this.executeLiquidation(pos as any, debtUSD);
                    }
                    this.isLiquidating = false;
                }
                
                // Log warning when HF drops significantly
                const prevHF = this.lastHF.get(pos.user);
                if (prevHF && hf < 1.02 && hf < prevHF - 0.001) {
                    log(`⚠️ HF DROPPING: ${pos.name} ${prevHF.toFixed(6)} -> ${hf.toFixed(6)}`, "WARN");
                }

                // Display status periodically for humans
                if (shouldDisplay) {
                    this.displayStatus(pos, hf, debtUSD, collateralUSD, blockNumber);
                }

            } catch (error) {
                // Silent fail - speed is priority
            }
        }

        if (shouldDisplay) {
            this.lastDisplayTime = now;
        }
    }

    /**
     * Human-readable status display (every 10 seconds)
     */
    private displayStatus(
        pos: WatchedPosition,
        hf: number,
        debtUSD: number,
        collateralUSD: number,
        blockNumber: number
    ) {
        const timeStr = new Date().toLocaleTimeString();
        const prevHF = this.positionHistory.get(pos.user)?.slice(-1)[0]?.healthFactor;
        
        // Calculate change
        let changeStr = "";
        if (prevHF) {
            const change = hf - prevHF;
            const arrow = change > 0 ? "📈" : change < 0 ? "📉" : "➡️";
            changeStr = ` ${arrow} ${change > 0 ? "+" : ""}${(change * 100).toFixed(4)}%`;
        }

        // Status indicator
        let status = "🟢";
        if (hf < 1.0) status = "🔴 LIQUIDATABLE!";
        else if (hf < 1.02) status = "🟠 CRITICAL";
        else if (hf < 1.05) status = "🟡 WARNING";

        // Distance to liquidation
        const distanceToLiq = ((hf - 1.0) * 100).toFixed(3);

        log(
            `[${timeStr}] Block ${blockNumber} | ${status} ` +
            `HF: ${hf.toFixed(6)}${changeStr} | ` +
            `Debt: $${debtUSD.toFixed(2)} | ` +
            `To Liq: ${distanceToLiq}% | ` +
            `${pos.name}`
        );

        // Store history
        const history = this.positionHistory.get(pos.user) || [];
        history.push({
            healthFactor: hf,
            collateralUSD,
            debtUSD,
            timestamp: new Date(),
            blockNumber,
        });
        if (history.length > 100) history.shift();
        this.positionHistory.set(pos.user, history);
    }

    private async checkPositions(blockNumber: number) {
        const timestamp = new Date();
        const timeStr = timestamp.toLocaleTimeString();

        for (const pos of WATCHED_POSITIONS) {
            try {
                const accountData = await this.monitor.getUserAccountData(pos.user);
                
                const hf = Number(accountData.healthFactor) / 1e18;
                const collateralUSD = Number(accountData.totalCollateralBase) / 1e8;
                const debtUSD = Number(accountData.totalDebtBase) / 1e8;

                // Store history
                const history = this.positionHistory.get(pos.user) || [];
                const newState: PositionState = {
                    healthFactor: hf,
                    collateralUSD,
                    debtUSD,
                    timestamp,
                    blockNumber,
                };
                history.push(newState);
                
                // Keep last 100 states
                if (history.length > 100) history.shift();
                this.positionHistory.set(pos.user, history);

                // Calculate change from last check
                let changeStr = "";
                if (history.length >= 2) {
                    const prev = history[history.length - 2];
                    const hfChange = hf - prev.healthFactor;
                    const arrow = hfChange > 0 ? "📈" : hfChange < 0 ? "📉" : "➡️";
                    changeStr = ` ${arrow} ${hfChange > 0 ? "+" : ""}${(hfChange * 100).toFixed(4)}%`;
                }

                // Status indicator
                let status = "🟢";
                if (hf < 1.0) status = "🔴 LIQUIDATABLE!";
                else if (hf < 1.02) status = "🟠 CRITICAL";
                else if (hf < 1.05) status = "🟡 WARNING";

                // Log
                console.log(
                    `[${timeStr}] Block ${blockNumber} | ${status} ` +
                    `HF: ${hf.toFixed(6)}${changeStr} | ` +
                    `Debt: $${debtUSD.toFixed(2)} | ${pos.name}`
                );

                // AUTO-LIQUIDATE if HF < 1.0
                if (hf < 1.0) {
                    console.log("\n" + "🔥".repeat(30));
                    console.log("🚨 LIQUIDATION OPPORTUNITY DETECTED!");
                    console.log("🔥".repeat(30));
                    const canExecute = AUTO_EXECUTE_AUTO || !pos.monitorOnly;
                    if (canExecute) {
                        await this.executeLiquidation(pos as any, debtUSD);
                    }
                }

            } catch (error: any) {
                console.error(`[${timeStr}] Error checking ${pos.name}:`, error.message);
            }
        }
    }

    private async executeLiquidation(
        pos: WatchedPosition,
        debtUSD: number
    ) {
        log(`\n⚡ Attempting to liquidate ${pos.name}...`, "LIQUIDATION");
        log(`   User: ${pos.user}`, "LIQUIDATION");
        log(`   Debt: $${debtUSD.toFixed(2)}`, "LIQUIDATION");

        try {
            // Calculate debt to cover (50% of total debt)
            // Convert USD to token amount based on decimals
            // For simplicity, use approximate prices
            const prices: Record<string, number> = {
                [TOKENS.WETH]: 3500,
                [TOKENS.wstETH]: 4000,
                [TOKENS.WBTC]: 95000,
                [TOKENS.LINK]: 15,
                [TOKENS.USDC]: 1,
                [TOKENS.USDCe]: 1,
                [TOKENS.USDT]: 1,
                [TOKENS.DAI]: 1,
            };
            
            const debtTokenPrice = prices[pos.debtToken] || 1;
            const debtInToken = debtUSD / debtTokenPrice;
            const debtToCover = ethers.utils.parseUnits(
                (debtInToken * 0.5).toFixed(pos.debtDecimals), // 50% of debt
                pos.debtDecimals
            );

            log(`   Debt to cover: ${ethers.utils.formatUnits(debtToCover, pos.debtDecimals)}`, "LIQUIDATION");

            // Skip simulation for speed — execute directly
            await this.doExecute(pos, debtToCover, pos.poolFee, debtUSD);

        } catch (error: any) {
            log(`   ❌ Liquidation failed: ${error.message}`, "ERROR");
        }
    }
    
    private async doExecute(
        pos: WatchedPosition,
        debtToCover: ethers.BigNumber,
        poolFee: number,
        debtUSD: number
    ) {
        log("\n   🚀 EXECUTING LIQUIDATION...", "LIQUIDATION");

        const tx = await this.executor.executeLiquidation(
            pos.user,
            pos.debtToken,
            pos.collateralToken,
            debtToCover,
            poolFee
        );

        log("\n   ✅ LIQUIDATION SUCCESSFUL!", "LIQUIDATION");
        log(`   TX: https://arbiscan.io/tx/${tx.hash}`, "LIQUIDATION");

        // Calculate estimated profit (5% bonus typical)
        const liquidationBonus = 0.05;
        const grossProfit = debtUSD * 0.5 * liquidationBonus;
        log(`   💰 Estimated Profit: ~$${grossProfit.toFixed(2)}`, "LIQUIDATION");
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    stop() {
        this.isRunning = false;
        if (this.wsProvider) {
            this.wsProvider.removeAllListeners();
        }
        log("\n🛑 Monitor stopped");
    }
}

// Run monitor
const monitor = new PositionMonitor();

// Handle graceful shutdown
process.on("SIGINT", () => {
    console.log("\n\nReceived SIGINT, shutting down...");
    monitor.stop();
    process.exit(0);
});

monitor.start().catch(error => {
    console.error("Monitor error:", error);
    process.exit(1);
});

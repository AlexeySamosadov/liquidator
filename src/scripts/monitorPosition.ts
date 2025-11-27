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

// Positions to watch - sorted by risk (lowest HF first)
const WATCHED_POSITIONS = [
    // 🔴 CRITICAL - HF < 1.01
    {
        user: "0x006c6daf53ad20a2149560129062a5b4d7aea991",
        name: "#1 wstETH/WETH $2749",
        debtToken: TOKENS.WETH,
        collateralToken: TOKENS.wstETH,
        debtDecimals: 18,
        poolFee: 100, // 0.01% for correlated assets
    },
    {
        user: "0x00c08911d0fcc1a1e9c567cac771c48f2efc4a24",
        name: "#2 LINK/USDC $4.87",
        debtToken: TOKENS.LINK,
        collateralToken: TOKENS.USDC,
        debtDecimals: 18,
        poolFee: 3000,
    },
    // 🟠 WARNING - HF < 1.05
    {
        user: "0x015d100e8870e49ed160db59fb0ed5e220b392ce",
        name: "#3 DAI/USDCe $1.00",
        debtToken: TOKENS.DAI,
        collateralToken: TOKENS.USDCe,
        debtDecimals: 18,
        poolFee: 100,
    },
    {
        user: "0x012e414b3043e5de1714cc0a03fa6e0125efd80e",
        name: "#4 Multi-token $0.90",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 6,
        poolFee: 500,
    },
    {
        user: "0x00febc822e74614296b9c11ecdf3e86646bfa8a7",
        name: "#5 USDT/USDCe $52",
        debtToken: TOKENS.USDT,
        collateralToken: TOKENS.USDCe,
        debtDecimals: 6,
        poolFee: 100,
    },
    {
        user: "0x008fe3c1f1b39af5453f9d0bccb60443751131ef",
        name: "#6 USDC/USDC $5010",
        debtToken: TOKENS.USDC,
        collateralToken: TOKENS.USDC,
        debtDecimals: 6,
        poolFee: 100,
    },
    {
        user: "0x0125dede2b2543e9f20d1a39e602d02c9cc4ff0f",
        name: "#7 WBTC/USDC+WETH $2533",
        debtToken: TOKENS.WBTC,
        collateralToken: TOKENS.WETH,
        debtDecimals: 8,
        poolFee: 500,
    },
    {
        user: "0x007b00d9782f048cb7203756a43c66777948a7fa",
        name: "#8 wstETH/WETH $166",
        debtToken: TOKENS.WETH,
        collateralToken: TOKENS.wstETH,
        debtDecimals: 18,
        poolFee: 100,
    },
];

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
        log(`Contract: ${FLASH_LIQUIDATOR_ADDRESS}`);
        log(`Watching: ${WATCHED_POSITIONS.length} positions`);
        log(`Log file: ${LOG_FILE}`);
        log(`Events file: ${EVENTS_FILE}`);
        log("=".repeat(60));
        log("\n⚡ BOT MODE: Checking EVERY block (~250ms)");
        log("📊 DISPLAY: Showing status every 10 seconds\n");

        this.isRunning = true;

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
                    this.isLiquidating = true;
                    log(`\n⚡ [${new Date().toISOString()}] HF=${hf.toFixed(6)} < 1.0 DETECTED! ${pos.name}`, "LIQUIDATION");
                    await this.executeLiquidation(pos, debtUSD);
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
        pos: typeof WATCHED_POSITIONS[0],
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
                    
                    await this.executeLiquidation(pos, debtUSD);
                }

            } catch (error: any) {
                console.error(`[${timeStr}] Error checking ${pos.name}:`, error.message);
            }
        }
    }

    private async executeLiquidation(
        pos: typeof WATCHED_POSITIONS[0],
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

            // Simulate first with position's preferred pool fee
            log("   🔍 Simulating liquidation...", "LIQUIDATION");
            const canExecute = await this.executor.simulateLiquidation(
                pos.user,
                pos.debtToken,
                pos.collateralToken,
                debtToCover,
                pos.poolFee
            );

            if (!canExecute) {
                log(`   ❌ Simulation failed with poolFee ${pos.poolFee}`, "WARN");
                
                // Try alternative pool fees
                for (const altFee of [100, 500, 3000, 10000]) {
                    if (altFee === pos.poolFee) continue;
                    
                    const canExecute2 = await this.executor.simulateLiquidation(
                        pos.user,
                        pos.debtToken,
                        pos.collateralToken,
                        debtToCover,
                        altFee
                    );

                    if (canExecute2) {
                        log(`   ✅ Simulation passed with poolFee ${altFee}!`, "LIQUIDATION");
                        await this.doExecute(pos, debtToCover, altFee, debtUSD);
                        return;
                    }
                }
                
                log("   ❌ All simulations failed. Skipping.", "ERROR");
                return;
            }

            log("   ✅ Simulation passed!", "LIQUIDATION");
            await this.doExecute(pos, debtToCover, pos.poolFee, debtUSD);

        } catch (error: any) {
            log(`   ❌ Liquidation failed: ${error.message}`, "ERROR");
        }
    }
    
    private async doExecute(
        pos: typeof WATCHED_POSITIONS[0],
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

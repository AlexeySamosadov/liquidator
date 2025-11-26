import { JsonRpcProvider, WebSocketProvider, Contract, EventLog, Log } from 'ethers';
import { Address } from '../../types';
import VenusContracts from '../../contracts';
import { logger } from '../../utils/logger';

type Provider = JsonRpcProvider | WebSocketProvider;

class EventMonitor {
  private readonly accountsSet = new Set<string>();

  private readonly eventListeners: Array<{ contract: Contract; eventName: string }> = [];

  private isRunning = false;

  private eventsProcessed = 0;

  private historicalAccounts = 0;

  // RPC telemetry counters
  private historicalQueryCount = 0;
  private historicalWindowsCount = 0;
  private historicalTotalLogCount = 0;

  // WebSocket reconnection
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimeoutId?: NodeJS.Timeout;

  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly provider: Provider,
    private readonly onAccountDiscovered: (account: Address) => void,
    private readonly historicalWindowBlocks: number,
    private readonly onHealthFactorChange?: (account: Address) => void,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    await this.provider.getNetwork();

    // Setup WebSocket reconnection if using WebSocket provider
    if (this.provider instanceof WebSocketProvider) {
      this.setupWebSocketReconnection();
    }

    const markets = await this.venusContracts.getAllVTokens(); // полное покрытие рынков
    for (const market of markets) {
      const vToken = this.venusContracts.getVToken(market);

      // Critical events that affect health factor - notify immediately
      this.subscribe(vToken, 'Borrow', (borrower: Address) => {
        this.handleDiscovered(borrower);
        this.onHealthFactorChange?.(borrower);
      });
      this.subscribe(vToken, 'RepayBorrow', (_payer: Address, borrower: Address) => {
        this.handleDiscovered(borrower);
        this.onHealthFactorChange?.(borrower);
      });
      this.subscribe(vToken, 'LiquidateBorrow', (_liquidator: Address, borrower: Address) => {
        this.handleDiscovered(borrower);
        this.onHealthFactorChange?.(borrower);
      });

      // Discovery events (mint/redeem change collateral, affect HF)
      this.subscribe(vToken, 'Mint', (minter: Address) => {
        this.handleDiscovered(minter);
        this.onHealthFactorChange?.(minter);
      });
      this.subscribe(vToken, 'Redeem', (redeemer: Address) => {
        this.handleDiscovered(redeemer);
        this.onHealthFactorChange?.(redeemer);
      });
    }

    this.isRunning = true;
    this.reconnectAttempts = 0;
    logger.info('Event monitor started', {
      markets: markets.length,
      listeners: this.eventListeners.length,
      isWebSocket: this.provider instanceof WebSocketProvider,
    });
  }

  private setupWebSocketReconnection(): void {
    const ws = this.provider as WebSocketProvider;

    // Monitor provider errors and handle disconnections
    ws.on('error', async (error: Error) => {
      logger.error('WebSocket provider error', { error, reconnectAttempts: this.reconnectAttempts });

      if (!this.isRunning) return;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        logger.error('Max WebSocket reconnection attempts reached, stopping event monitor');
        this.stop();
        return;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, ..., max 60s
      const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
      this.reconnectAttempts++;

      logger.info('Reconnecting WebSocket...', { delayMs, attempt: this.reconnectAttempts });

      this.reconnectTimeoutId = setTimeout(async () => {
        try {
          this.stop();
          await this.start();
          logger.info('WebSocket reconnected successfully');
        } catch (error) {
          logger.error('WebSocket reconnection failed', { error });
        }
      }, delayMs);
    });

    logger.info('WebSocket reconnection handler configured', { maxAttempts: this.maxReconnectAttempts });
  }

  stop(): void {
    if (!this.isRunning) return;

    // Clear reconnection timeout
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = undefined;
    }

    // Remove all event listeners
    for (const { contract, eventName } of this.eventListeners) {
      contract.removeAllListeners(eventName);
    }
    this.eventListeners.length = 0;
    this.isRunning = false;

    // Close WebSocket connection
    if (this.provider instanceof WebSocketProvider) {
      this.provider.destroy();
    }

    logger.info('Event monitor stopped');
  }

  getDiscoveredAccounts(): Address[] {
    return Array.from(this.accountsSet.values());
  }

  getEventsProcessed(): number {
    return this.eventsProcessed;
  }

  getHistoricalAccounts(): number {
    return this.historicalAccounts;
  }

  getRpcTelemetry(): { queryCount: number; windowCount: number; totalLogs: number } {
    return {
      queryCount: this.historicalQueryCount,
      windowCount: this.historicalWindowsCount,
      totalLogs: this.historicalTotalLogCount,
    };
  }

  async historicalScan(fromBlock: number, toBlock: number): Promise<void> {
    // Сканируем все рынки, но порциями по окнам, чтобы не ловить rate-limit
    const markets = await this.venusContracts.getAllVTokens();
    let discovered = 0;
    let logsSeen = 0;
    let totalQueryCalls = 0;
    let totalWindows = 0;
    const window = Math.max(this.historicalWindowBlocks, 50); // минимум 50 блоков для адекватных запросов

    logger.info('Historical scan started', { fromBlock, toBlock, markets: markets.length, windowBlocks: window, totalBlocksToScan: toBlock - fromBlock + 1 });

    for (const market of markets) {
      const vToken = this.venusContracts.getVToken(market);
      let marketLogs = 0;
      let marketWindows = 0;

      for (let start = fromBlock; start <= toBlock; start += window) {
        const end = Math.min(start + window - 1, toBlock);
        marketWindows++;

        // Borrow events
        try {
          this.historicalQueryCount++;
          const borrowLogs = await vToken.queryFilter(vToken.filters.Borrow(), start, end);
          logsSeen += borrowLogs.length;
          marketLogs += borrowLogs.length;
          for (const log of borrowLogs) {
            const ev = log as EventLog | Log;
            const borrower = (ev as EventLog).args?.[0] as Address | undefined;
            if (borrower) this.handleDiscovered(borrower);
            discovered += 1;
          }
        } catch (error) {
          logger.warn('Historical scan borrow failed', { market, start, end, error });
        }

        // RepayBorrow events
        try {
          this.historicalQueryCount++;
          const repayLogs = await vToken.queryFilter(vToken.filters.RepayBorrow(), start, end);
          logsSeen += repayLogs.length;
          marketLogs += repayLogs.length;
          for (const log of repayLogs) {
            const ev = log as EventLog | Log;
            const borrower = (ev as EventLog).args?.[1] as Address | undefined;
            if (borrower) this.handleDiscovered(borrower);
            discovered += 1;
          }
        } catch (error) {
          logger.warn('Historical scan repay failed', { market, start, end, error });
        }
      }

      logger.info('Historical scan market done', { market, logsSeen: marketLogs, windows: marketWindows, queryCalls: marketWindows * 2 });
      totalQueryCalls += marketWindows * 2; // 2 event types per window
      totalWindows += marketWindows;
    }

    this.historicalAccounts += discovered;
    this.historicalTotalLogCount += logsSeen;
    this.historicalWindowsCount += totalWindows;

    logger.info('Historical scan completed', {
      fromBlock,
      toBlock,
      markets: markets.length,
      logsSeen,
      windowBlocks: window,
      totalQueryCalls,
      totalWindows,
      discoveredAccounts: discovered,
      avgLogsPerQuery: logsSeen / Math.max(totalQueryCalls, 1),
      avgQueryCallsPerMarket: totalQueryCalls / Math.max(markets.length, 1),
    });
  }

  private subscribe(contract: Contract, eventName: string, handler: (...args: any[]) => void): void {
    const wrappedHandler = async (...args: any[]): Promise<void> => {
      try {
        handler(...args);
        this.eventsProcessed += 1;
      } catch (error) {
        logger.error('Event handler failed', { eventName, error });
      }
    };

    contract.on(eventName, wrappedHandler);
    this.eventListeners.push({ contract, eventName });
  }

  private handleDiscovered(account: Address): void {
    const key = account.toLowerCase();
    if (this.accountsSet.has(key)) return;

    this.accountsSet.add(key);
    logger.info('Discovered account via events', { account });
    this.onAccountDiscovered(account);
  }
}

export default EventMonitor;

import { JsonRpcProvider, Contract } from 'ethers';
import { Address } from '../../types';
import VenusContracts from '../../contracts';
import { logger } from '../../utils/logger';

class EventMonitor {
  private readonly accountsSet = new Set<string>();

  private readonly eventListeners: Array<{ contract: Contract; eventName: string }> = [];

  private isRunning = false;

  private eventsProcessed = 0;

  constructor(
    private readonly venusContracts: VenusContracts,
    private readonly provider: JsonRpcProvider,
    private readonly onAccountDiscovered: (account: Address) => void,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    await this.provider.getNetwork();

    const markets = await this.venusContracts.getAllVTokens();
    for (const market of markets) {
      const vToken = this.venusContracts.getVToken(market);

      this.subscribe(vToken, 'Borrow', (borrower: Address) => this.handleDiscovered(borrower));
      this.subscribe(vToken, 'RepayBorrow', (_payer: Address, borrower: Address) => this.handleDiscovered(borrower));
      this.subscribe(vToken, 'Mint', (minter: Address) => this.handleDiscovered(minter));
      this.subscribe(vToken, 'Redeem', (redeemer: Address) => this.handleDiscovered(redeemer));
      this.subscribe(vToken, 'LiquidateBorrow', (_liquidator: Address, borrower: Address) => this.handleDiscovered(borrower));
    }

    this.isRunning = true;
    logger.info('Event monitor started', { markets: markets.length, listeners: this.eventListeners.length });
  }

  stop(): void {
    if (!this.isRunning) return;

    for (const { contract, eventName } of this.eventListeners) {
      contract.removeAllListeners(eventName);
    }
    this.eventListeners.length = 0;
    this.isRunning = false;
    logger.info('Event monitor stopped');
  }

  getDiscoveredAccounts(): Address[] {
    return Array.from(this.accountsSet.values());
  }

  getEventsProcessed(): number {
    return this.eventsProcessed;
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

import { Address } from '../../src/types';

type EventType = 'Borrow' | 'RepayBorrow' | 'Mint' | 'Redeem' | 'LiquidateBorrow' | string;

export class MockEventMonitor {
  private discovered = new Set<string>();

  private eventsProcessed = 0;

  private running = false;

  private startError = false;

  private onAccountDiscovered: ((account: Address) => void) | null = null;

  private startCount = 0;

  private stopCount = 0;

  constructor(onAccountDiscovered?: (account: Address) => void) {
    this.onAccountDiscovered = onAccountDiscovered ?? null;
  }

  setOnAccountDiscovered(cb: (account: Address) => void): void {
    this.onAccountDiscovered = cb;
  }

  async start(): Promise<void> {
    this.startCount += 1;
    if (this.startError) throw new Error('Mock start error');
    this.running = true;
    if (this.onAccountDiscovered) {
      this.discovered.forEach((acc) => this.onAccountDiscovered?.(acc));
    }
  }

  stop(): void {
    this.stopCount += 1;
    this.running = false;
  }

  getDiscoveredAccounts(): Address[] {
    return Array.from(this.discovered.values());
  }

  getEventsProcessed(): number {
    return this.eventsProcessed;
  }

  addDiscoveredAccount(account: Address): void {
    this.discovered.add(account.toLowerCase());
  }

  setEventsProcessed(count: number): void {
    this.eventsProcessed = count;
  }

  mockStartError(): void {
    this.startError = true;
  }

  simulateEvent(type: EventType, account: Address): void {
    this.eventsProcessed += 1;
    this.discovered.add(account.toLowerCase());
    this.onAccountDiscovered?.(account);
  }

  getStartCallCount(): number {
    return this.startCount;
  }

  getStopCallCount(): number {
    return this.stopCount;
  }

  isRunning(): boolean {
    return this.running;
  }
}

export default MockEventMonitor;

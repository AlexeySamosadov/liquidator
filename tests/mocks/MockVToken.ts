import { ContractTransactionResponse } from 'ethers';
import { AccountSnapshot, Address } from '../../src/types';
import { createMockTransactionResponse } from '../utils/testHelpers';

type SnapshotMap = Map<string, AccountSnapshot>;

// Lightweight mock; cast to `any` when passing where an IVToken is expected.
export class MockVToken {
  private underlyingToken: Address | null = null;

  private exchangeRate: bigint = 0n;

  private borrowBalances = new Map<string, bigint>();

  private balances = new Map<string, bigint>();

  private tokenSymbol = 'vTOKEN';

  private tokenDecimals = 8;

  private snapshots: SnapshotMap = new Map();

  private liquidateSuccess = true;

  private liquidateHash = '';

  constructor(init?: { underlying?: Address | null; exchangeRate?: bigint; symbol?: string; decimals?: number }) {
    if (init?.underlying !== undefined) this.underlyingToken = init.underlying;
    if (init?.exchangeRate !== undefined) this.exchangeRate = init.exchangeRate;
    if (init?.symbol) this.tokenSymbol = init.symbol;
    if (init?.decimals !== undefined) this.tokenDecimals = init.decimals;
  }

  setUnderlying(address: Address | null): void {
    this.underlyingToken = address;
  }

  setExchangeRate(rate: bigint): void {
    this.exchangeRate = rate;
  }

  setBorrowBalance(account: Address, balance: bigint): void {
    this.borrowBalances.set(account.toLowerCase(), balance);
  }

  setBalance(account: Address, balance: bigint): void {
    this.balances.set(account.toLowerCase(), balance);
  }

  setSymbol(symbol: string): void {
    this.tokenSymbol = symbol;
  }

  setDecimals(decimals: number): void {
    this.tokenDecimals = decimals;
  }

  setAccountSnapshot(account: Address, snapshot: AccountSnapshot): void {
    this.snapshots.set(account.toLowerCase(), snapshot);
  }

  mockLiquidateBorrow(success: boolean, txHash: string = ''): void {
    this.liquidateSuccess = success;
    this.liquidateHash = txHash;
  }

  async underlying(): Promise<Address> {
    if (!this.underlyingToken) throw new Error('vBNB market has no underlying');
    return this.underlyingToken;
  }

  async exchangeRateStored(): Promise<bigint> {
    return this.exchangeRate;
  }

  async borrowBalanceStored(account: Address): Promise<bigint> {
    return this.borrowBalances.get(account.toLowerCase()) ?? 0n;
  }

  async balanceOf(account: Address): Promise<bigint> {
    return this.balances.get(account.toLowerCase()) ?? 0n;
  }

  async symbol(): Promise<string> {
    return this.tokenSymbol;
  }

  async decimals(): Promise<number> {
    return this.tokenDecimals;
  }

  async getAccountSnapshot(account: Address): Promise<AccountSnapshot> {
    const key = account.toLowerCase();
    const existing = this.snapshots.get(key);
    if (existing) return existing;
    return {
      error: 0n,
      vTokenBalance: 0n,
      borrowBalance: this.borrowBalances.get(key) ?? 0n,
      exchangeRate: this.exchangeRate,
    };
  }

  async liquidateBorrow(
    _borrower: Address,
    _repayAmount: bigint,
    _vTokenCollateral: Address,
  ): Promise<ContractTransactionResponse> {
    if (!this.liquidateSuccess) {
      throw new Error('Liquidation failed');
    }
    return createMockTransactionResponse({
      hash: this.liquidateHash || undefined,
      success: true,
    }) as unknown as ContractTransactionResponse;
  }
}

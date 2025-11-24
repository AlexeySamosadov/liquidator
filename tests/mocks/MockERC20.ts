import { ContractTransactionResponse } from 'ethers';
import { Address } from '../../src/types';
import { createMockTransactionResponse } from '../utils/testHelpers';

type AllowanceMap = Map<string, Map<string, bigint>>;

type ApproveRecord = { owner: Address; spender: Address; amount: bigint };
type TransferRecord = { from: Address; to: Address; amount: bigint };

// Lightweight ERC20 mock; cast to `any` when a real contract instance is expected.
export class MockERC20 {
  private balances = new Map<string, bigint>();

  private allowances: AllowanceMap = new Map();

  private approveHistory: ApproveRecord[] = [];

  private transferHistory: TransferRecord[] = [];

  private revertReason: string | undefined;

  private caller: Address = '0x0000000000000000000000000000000000000001';

  setCaller(address: Address): void {
    this.caller = address;
  }

  setBalance(address: Address, amount: bigint): void {
    this.balances.set(address.toLowerCase(), amount);
  }

  setAllowance(owner: Address, spender: Address, amount: bigint): void {
    const ownerKey = owner.toLowerCase();
    const allowances = this.allowances.get(ownerKey) ?? new Map<string, bigint>();
    allowances.set(spender.toLowerCase(), amount);
    this.allowances.set(ownerKey, allowances);
  }

  shouldRevert(revert: boolean, reason?: string): void {
    this.revertReason = revert ? reason ?? 'Mock ERC20 reverted' : undefined;
  }

  private ensureNotReverting(): void {
    if (this.revertReason) throw new Error(this.revertReason);
  }

  async balanceOf(address: Address): Promise<bigint> {
    this.ensureNotReverting();
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }

  async allowance(owner: Address, spender: Address): Promise<bigint> {
    this.ensureNotReverting();
    const existing = this.allowances.get(owner.toLowerCase());
    return existing?.get(spender.toLowerCase()) ?? 0n;
  }

  async approve(spender: Address, amount: bigint): Promise<ContractTransactionResponse> {
    this.ensureNotReverting();
    const owner = this.caller;
    this.setAllowance(owner, spender, amount);
    this.approveHistory.push({ owner, spender, amount });
    return createMockTransactionResponse({ success: true }) as unknown as ContractTransactionResponse;
  }

  async transfer(to: Address, amount: bigint): Promise<ContractTransactionResponse> {
    this.ensureNotReverting();
    const fromKey = this.caller.toLowerCase();
    const balance = this.balances.get(fromKey) ?? 0n;
    if (balance < amount) throw new Error('Insufficient balance');
    this.balances.set(fromKey, balance - amount);
    const toKey = to.toLowerCase();
    this.balances.set(toKey, (this.balances.get(toKey) ?? 0n) + amount);
    this.transferHistory.push({ from: this.caller, to, amount });
    return createMockTransactionResponse({ success: true }) as unknown as ContractTransactionResponse;
  }

  getApproveHistory(): ApproveRecord[] {
    return this.approveHistory;
  }

  getTransferHistory(): TransferRecord[] {
    return this.transferHistory;
  }
}

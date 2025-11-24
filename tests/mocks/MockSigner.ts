import { TransactionResponse } from 'ethers';
import { Address } from '../../src/types';
import { createMockTransactionResponse, randomAddress } from '../utils/testHelpers';
import { MockProvider } from './MockProvider';

type TxParams = {
  to?: Address;
  value?: bigint;
  data?: string;
  gasLimit?: bigint;
};

// NOTE: Plain mock that does not extend ethers.Signer; cast to `any` when passing to services expecting a real signer.
export class MockSigner {
  private address: Address;

  private provider?: MockProvider;

  private balance: bigint = 0n;

  private sendSuccess = true;

  private txHash: string | undefined;

  private revertReason: string | undefined;

  private sent: TxParams[] = [];

  constructor(address?: Address) {
    this.address = address ?? randomAddress();
  }

  setAddress(address: Address): void {
    this.address = address;
  }

  setBalance(balance: bigint): void {
    this.balance = balance;
  }

  mockSendTransaction(success: boolean, txHash?: string, _receipt?: any): void {
    this.sendSuccess = success;
    this.txHash = txHash;
  }

  shouldRevert(revert: boolean, reason?: string): void {
    this.revertReason = revert ? reason ?? 'Send reverted' : undefined;
  }

  connect(provider: MockProvider): MockSigner {
    this.provider = provider;
    return this;
  }

  getProvider(): MockProvider | undefined {
    return this.provider;
  }

  async getAddress(): Promise<Address> {
    return this.address;
  }

  async signTransaction(_tx: TxParams): Promise<string> {
    if (this.revertReason) throw new Error(this.revertReason);
    return '0xsignedtransaction';
  }

  async sendTransaction(tx: TxParams): Promise<TransactionResponse> {
    this.sent.push(tx);
    if (tx.value !== undefined && tx.value > this.balance) {
      throw new Error('Insufficient balance');
    }
    if (tx.value !== undefined) {
      this.balance -= tx.value;
    }
    if (this.revertReason) throw new Error(this.revertReason);
    if (!this.sendSuccess) throw new Error('Transaction failed');
    return createMockTransactionResponse({ hash: this.txHash, success: true });
  }

  async signMessage(_message: string | Uint8Array): Promise<string> {
    if (this.revertReason) throw new Error(this.revertReason);
    return '0xsignedmessage';
  }

  getSentTransactions(): TxParams[] {
    return this.sent;
  }

  getBalance(): bigint {
    return this.balance;
  }
}

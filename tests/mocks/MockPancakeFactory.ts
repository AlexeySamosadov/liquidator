import { Address } from '../../src/types';

type PoolKey = string;

export class MockPancakeFactory {
  private pools = new Map<PoolKey, Address>();

  private callCounts = new Map<PoolKey, number>();

  private key(tokenA: Address, tokenB: Address, fee: number): PoolKey {
    const a = tokenA.toLowerCase();
    const b = tokenB.toLowerCase();
    return `${a}-${b}-${fee}`;
  }

  registerPool(tokenA: Address, tokenB: Address, fee: number, poolAddress: Address): void {
    this.pools.set(this.key(tokenA, tokenB, fee), poolAddress);
    this.pools.set(this.key(tokenB, tokenA, fee), poolAddress);
  }

  registerPools(pools: Array<{ tokenA: Address; tokenB: Address; fee: number; poolAddress: Address }>): void {
    pools.forEach((p) => this.registerPool(p.tokenA, p.tokenB, p.fee, p.poolAddress));
  }

  removePool(tokenA: Address, tokenB: Address, fee: number): void {
    this.pools.delete(this.key(tokenA, tokenB, fee));
    this.pools.delete(this.key(tokenB, tokenA, fee));
  }

  clearPools(): void {
    this.pools.clear();
  }

  async getPool(tokenA: Address, tokenB: Address, fee: number): Promise<Address> {
    const key = this.key(tokenA, tokenB, fee);
    this.callCounts.set(key, (this.callCounts.get(key) ?? 0) + 1);
    return this.pools.get(key) ?? '0x0000000000000000000000000000000000000000';
  }
}

import { Address } from '../../src/types';
import { MockComptroller } from './MockComptroller';
import { MockPriceOracle } from './MockPriceOracle';
import { MockLiquidator } from './MockLiquidator';
import { MockVToken } from './MockVToken';

// Lightweight wrapper that mirrors VenusContracts interface for testing.
export class MockVenusContracts {
  private oracle?: MockPriceOracle;

  private liquidator?: MockLiquidator | null;

  private readonly vTokens: Map<Address, MockVToken>;

  constructor(private readonly comptroller: MockComptroller, init?: {
    oracle?: MockPriceOracle;
    liquidator?: MockLiquidator | null;
    vTokens?: Map<Address, MockVToken>;
  }) {
    this.oracle = init?.oracle;
    this.liquidator = init?.liquidator ?? null;
    this.vTokens = init?.vTokens ?? new Map<Address, MockVToken>();
  }

  async initialize(): Promise<void> {
    // keep signature compatibility with real implementation
  }

  getComptroller(): MockComptroller {
    return this.comptroller;
  }

  getOracle(): MockPriceOracle {
    if (!this.oracle) throw new Error('Price oracle is not initialized yet');
    return this.oracle;
  }

  getLiquidator(): MockLiquidator | null {
    return this.liquidator ?? null;
  }

  getVToken(address: Address): MockVToken {
    const token = this.vTokens.get(address.toLowerCase());
    if (!token) throw new Error(`vToken not found: ${address}`);
    // align with ethers Contract connect behavior
    if (!(token as any).connect) {
      (token as any).connect = () => token;
    }
    return token;
  }

  async getAllVTokens(): Promise<Address[]> {
    return Array.from(this.vTokens.keys());
  }

  getVTokenForUnderlying(underlying: Address): Address | undefined {
    for (const [address, token] of this.vTokens.entries()) {
      if ((token as any).underlyingToken === underlying || (token as any).underlyingToken?.toLowerCase?.() === underlying.toLowerCase()) {
        return address;
      }
    }
    return undefined;
  }

  setVToken(address: Address, vToken: MockVToken): void {
    this.vTokens.set(address.toLowerCase(), vToken);
  }

  setOracle(oracle: MockPriceOracle): void {
    this.oracle = oracle;
  }

  setLiquidator(liquidator: MockLiquidator | null): void {
    this.liquidator = liquidator;
  }
}

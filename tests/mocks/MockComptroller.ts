import { Address, AccountLiquidity } from '../../src/types';

// Lightweight mock; cast to `any` when passing where a real IComptroller is expected.
export class MockComptroller {
  private markets: Address[] = [];

  private liquidityByAccount = new Map<string, AccountLiquidity>();

  private assetsInByAccount = new Map<string, Address[]>();

  private oracleAddress: Address = '0x0000000000000000000000000000000000000000';

  private liquidatorAddress: Address | null = null;

  private liquidationIncentive: bigint = 1_080_000_000_000_000_000n; // 1.08e18

  setMarkets(markets: Address[]): void {
    this.markets = markets;
  }

  setAccountLiquidity(account: Address, liquidity: AccountLiquidity): void {
    this.liquidityByAccount.set(account.toLowerCase(), liquidity);
  }

  setAssetsIn(account: Address, assets: Address[]): void {
    this.assetsInByAccount.set(account.toLowerCase(), assets);
  }

  setOracleAddress(address: Address): void {
    this.oracleAddress = address;
  }

  setLiquidatorAddress(address: Address | null): void {
    this.liquidatorAddress = address;
  }

  setLiquidationIncentive(incentive: bigint): void {
    this.liquidationIncentive = incentive;
  }

  async getAllMarkets(): Promise<Address[]> {
    return this.markets;
  }

  async getAccountLiquidity(account: Address): Promise<AccountLiquidity> {
    const liq = this.liquidityByAccount.get(account.toLowerCase());
    if (liq) return liq;
    return { error: 0n, liquidity: 0n, shortfall: 0n };
  }

  async getAssetsIn(account: Address): Promise<Address[]> {
    return this.assetsInByAccount.get(account.toLowerCase()) ?? [];
  }

  async oracle(): Promise<Address> {
    return this.oracleAddress;
  }

  async liquidatorContract(): Promise<Address> {
    if (!this.liquidatorAddress) throw new Error('Liquidator not set');
    return this.liquidatorAddress;
  }

  async liquidationIncentiveMantissa(): Promise<bigint> {
    return this.liquidationIncentive;
  }
}

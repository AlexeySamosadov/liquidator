import { Address, AccountLiquidity } from '../../src/types';

// Lightweight mock; cast to `any` when passing where a real IComptroller is expected.
export class MockComptroller {
  private marketsList: Address[] = [];

  private liquidityByAccount = new Map<string, AccountLiquidity>();

  private assetsInByAccount = new Map<string, Address[]>();

  private oracleAddress: Address = '0x0000000000000000000000000000000000000000';

  private liquidatorAddress: Address | null = null;

  private liquidationIncentive: bigint = 1_080_000_000_000_000_000n; // 1.08e18

  private marketsData = new Map<string, { liquidationIncentiveMantissa: bigint }>();

  setMarkets(markets: Address[]): void {
    this.marketsList = markets;
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

  setMarketsWithLiquidationIncentive(incentive: bigint, vToken: Address): void {
    this.marketsData.set(vToken.toLowerCase(), { liquidationIncentiveMantissa: incentive });
  }

  async getAllMarkets(): Promise<Address[]> {
    return this.marketsList;
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

  async getLiquidationIncentive(vToken: Address): Promise<bigint> {
    const marketData = this.marketsData.get(vToken.toLowerCase());
    if (marketData) {
      return marketData.liquidationIncentiveMantissa;
    }
    // Return global liquidation incentive if no market-specific data
    return this.liquidationIncentive;
  }

  async markets(vToken: Address): Promise<{ liquidationIncentiveMantissa: bigint }> {
    const marketData = this.marketsData.get(vToken.toLowerCase());
    if (marketData) {
      return marketData;
    }
    // Return global liquidation incentive if no market-specific data
    return { liquidationIncentiveMantissa: this.liquidationIncentive };
  }
}

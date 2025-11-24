import { formatUnits } from 'ethers';

export const toHumanAmount = (amount: bigint, decimals: number): number => (
  Number.parseFloat(formatUnits(amount, decimals))
);

export const amountToUsd = (amount: bigint, priceUsd: number, decimals: number): number => (
  toHumanAmount(amount, decimals) * priceUsd
);

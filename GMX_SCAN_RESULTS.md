# GMX V2 Scan Results

## Overview
- **Date**: 2025-11-26
- **Method**: Official GMX SDK + Subsquid GraphQL
- **Total Positions Found**: 1000
- **Potentially Liquidatable**: 50+

## Findings
The scan successfully retrieved active positions from the GMX V2 Subgraph.
However, many positions show **$0.00 collateral** and extremely high leverage (e.g., `4e+25x`).

### Top Liquidatable Candidates
| Account | Market | Size (USD) | Collateral | Leverage | Type |
|---------|--------|------------|------------|----------|------|
| `0xe4d3...2c62` | `0x47c0...3123` (BTC/USD) | $65.7M | $0.00 | 4.7e25x | SHORT |
| `0xe4d3...2c62` | `0x70d9...5587` (ETH/USD) | $56.7M | $0.00 | 2.2e25x | SHORT |
| `0xAb30...f603` | `0x47c0...3123` (BTC/USD) | $54.9M | $0.00 | 1.8e25x | SHORT |
| `0xAB16...1809` | `0x70d9...5587` (ETH/USD) | $51.6M | $0.00 | 1.0e26x | SHORT |

### Analysis
1. **Data Validity**: The `$0.00` collateral suggests either:
   - The subgraph `collateralAmount` field is not reflecting the true collateral (might be in a different field or calculated differently).
   - These are "zombie" positions or have been liquidated but not updated in subgraph (unlikely if `sizeInUsd > 0`).
   - Collateral is stored in `collateralToken` but the value is not being parsed correctly (decimals issue?).
   
2. **Next Steps**:
   - Verify these positions on-chain using `GMXReader` contract.
   - The SDK scanner proves **we can find positions**.
   - We need to cross-reference these `account` + `market` pairs with the `Reader` contract to get the *actual* real-time health factor.

## Conclusion
The SDK/GraphQL approach is **WORKING** to discover positions. The next step is to feed these discovered accounts into our `GMXMonitoringService` to validate them against the blockchain and execute liquidations if they are truly undercollateralized.

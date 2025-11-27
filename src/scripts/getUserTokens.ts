import { ethers } from "ethers";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const ARBITRUM_RPC = process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc";
const AAVE_SUBGRAPH = "https://gateway-arbitrum.network.thegraph.com/api/" + process.env.THE_GRAPH_API_KEY + "/subgraphs/id/DLKsRs56hevRCaPH2X5HCnX3FtLFcPLi2QAC68iNi6v";
const TEST_USER = "0x00000000d70742d790f9936f25d414dbce6818b0";

async function getUserTokensFromSubgraph(userAddress: string) {
    console.log("\n🔍 Querying The Graph for user's positions...\n");
    
    const query = `
        query getUserPositions($user: String!) {
            account(id: $user) {
                id
                deposits(where: { amount_gt: "0" }) {
                    amount
                    reserve {
                        symbol
                        underlyingAsset
                        decimals
                    }
                }
                borrows(where: { amount_gt: "0" }) {
                    amount
                    reserve {
                        symbol
                        underlyingAsset
                        decimals
                    }
                }
            }
        }
    `;

    try {
        const response = await axios.post(AAVE_SUBGRAPH, {
            query,
            variables: {
                user: userAddress.toLowerCase()
            }
        });

        if (response.data.errors) {
            console.error("GraphQL errors:", response.data.errors);
            return null;
        }

        const account = response.data.data?.account;
        
        if (!account) {
            console.log("❌ User not found in subgraph");
            return null;
        }

        console.log("✅ User found!\n");
        
        console.log("📊 Deposits (Collateral):");
        if (account.deposits && account.deposits.length > 0) {
            account.deposits.forEach((deposit: any) => {
                const amount = ethers.utils.formatUnits(
                    deposit.amount,
                    deposit.reserve.decimals
                );
                console.log(`  - ${deposit.reserve.symbol}: ${amount}`);
                console.log(`    Address: ${deposit.reserve.underlyingAsset}`);
            });
        } else {
            console.log("  (none)");
        }

        console.log("\n💸 Borrows (Debt):");
        if (account.borrows && account.borrows.length > 0) {
            account.borrows.forEach((borrow: any) => {
                const amount = ethers.utils.formatUnits(
                    borrow.amount,
                    borrow.reserve.decimals
                );
                console.log(`  - ${borrow.reserve.symbol}: ${amount}`);
                console.log(`    Address: ${borrow.reserve.underlyingAsset}`);
            });
        } else {
            console.log("  (none)");
        }

        return account;

    } catch (error: any) {
        console.error("❌ Subgraph query failed:", error.message);
        return null;
    }
}

async function main() {
    console.log("=".repeat(60));
    console.log("User:", TEST_USER);
    console.log("=".repeat(60));

    const account = await getUserTokensFromSubgraph(TEST_USER);

    if (account && account.deposits?.length > 0 && account.borrows?.length > 0) {
        console.log("\n✅ Found liquidation pair:");
        console.log("Debt Asset:", account.borrows[0].reserve.symbol, "-", account.borrows[0].reserve.underlyingAsset);
        console.log("Collateral Asset:", account.deposits[0].reserve.symbol, "-", account.deposits[0].reserve.underlyingAsset);
        
        console.log("\n💡 Use these addresses in liquidation script!");
    }
}

main().catch(console.error);

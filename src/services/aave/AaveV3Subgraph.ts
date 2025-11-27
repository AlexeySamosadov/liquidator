import { request, gql } from 'graphql-request';
import dotenv from 'dotenv';

dotenv.config();

// Get API key from environment
const API_KEY = process.env.GRAPH_API_KEY || '';

// Aave V3 Arbitrum Subgraph endpoint (Decentralized Network)
// Official deployment ID from: https://github.com/aave/protocol-subgraphs
const SUBGRAPH_URL = API_KEY
    ? `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B`
    : 'https://gateway.thegraph.com/api/subgraphs/id/DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B';

if (!API_KEY) {
    console.warn('⚠️  GRAPH_API_KEY not set in .env - queries will fail');
} else {
    console.log('✅ The Graph API key loaded');
}

export interface BorrowerSummary {
    address: string;
    totalDebtUSD: number;
    totalCollateralUSD: number;
    healthFactor: number;
    hasDebt: boolean;
}

export class AaveV3Subgraph {
    private subgraphUrl: string;

    constructor(subgraphUrl: string = SUBGRAPH_URL) {
        this.subgraphUrl = subgraphUrl;
    }

    /**
     * Get all users with active borrows
     * Note: Aave V3 subgraph doesn't have healthFactor/totalDebt fields on User
     * We get borrowers list and check HF on-chain with AaveV3Monitor
     */
    async getAllBorrowers(): Promise<string[]> {
        const query = gql`
      query GetBorrowers {
        users(
          first: 1000
          where: { borrowedReservesCount_gt: 0 }
        ) {
          id
        }
      }
    `;

        try {
            const data: any = await request(this.subgraphUrl, query);

            const borrowers = data.users.map((user: any) => user.id);
            console.log(`📊 Found ${borrowers.length} borrowers from subgraph`);

            return borrowers;
        } catch (error) {
            console.error('Error fetching borrowers from subgraph:', error);
            throw error;
        }
    }

    /**
     * Get borrowers for liquidation check
     * Returns list - HF will be calculated on-chain
     */
    async getLowHealthFactorUsers(): Promise<BorrowerSummary[]> {
        const borrowers = await this.getAllBorrowers();

        console.log(`\n📋 Returning ${borrowers.length} borrowers for on-chain HF check`);
        console.log(`   (Health factor will be calculated on-chain by AaveV3Monitor)\n`);

        // Return as BorrowerSummary format (will be checked on-chain)
        return borrowers.map(address => ({
            address,
            totalDebtUSD: 0, // Will be fetched on-chain
            totalCollateralUSD: 0, // Will be fetched on-chain  
            healthFactor: 0, // Will be calculated on-chain
            hasDebt: true
        }));
    }

    /**
     * Monitor for positions (simplified version)
     */
    async *monitorLiquidatablePositions(
        pollIntervalMs: number = 60000
    ): AsyncGenerator<BorrowerSummary[], void, unknown> {
        while (true) {
            try {
                const users = await this.getLowHealthFactorUsers();

                if (users.length > 0) {
                    yield users;
                }

                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            } catch (error) {
                console.error('Error in monitoring loop:', error);
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs * 2));
            }
        }
    }
}

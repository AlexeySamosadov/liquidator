import dotenv from 'dotenv';

dotenv.config();

// Count Aave V3 Arbitrum borrowers via The Graph with small page size
// Usage: GRAPH_API_KEY=xxx SUBGRAPH_ID=DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B npx tsx src/scripts/countAaveBorrowers.ts

const API_KEY = process.env.GRAPH_API_KEY || '';
const SUBGRAPH_ID = process.env.SUBGRAPH_ID || 'DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B';
const BATCH = Number(process.env.GRAPH_BATCH || 500); // smaller limit
const MAX_BATCHES = Number(process.env.GRAPH_MAX_BATCHES || 100000);

if (!API_KEY) {
  console.error('GRAPH_API_KEY is missing in .env');
  process.exit(1);
}

const ENDPOINT = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;

type User = { id: string };

async function queryBatch(idGt: string | null): Promise<User[]> {
  const where = idGt ? `, id_gt: \"${idGt}\"` : '';
  const query = {
    query: `{
      users(first: ${BATCH}, where: { borrowedReservesCount_gt: 0${where} }, orderBy: id) { id }
    }`,
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as any;
      if (data.errors) throw new Error(JSON.stringify(data.errors));
      return (data.data?.users || []) as User[];
    } catch (e: any) {
      const wait = 500 * (attempt + 1);
      await new Promise(r => setTimeout(r, wait));
      if (attempt === 4) throw e;
    }
  }
  return [];
}

async function main() {
  let total = 0;
  let lastId: string | null = null;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const users = await queryBatch(lastId);
    const n = users.length;
    total += n;
    if (n === 0) break;
    lastId = users[n - 1].id;

    if (i % 10 === 0 || n < BATCH) {
      console.log(`Batch ${i + 1}: +${n} (total: ${total}) lastId=${lastId}`);
    }

    if (n < BATCH) break;
  }

  console.log(`\n=== TOTAL OPEN BORROWER ACCOUNTS (Aave V3 Arbitrum): ${total} ===`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});

import dotenv from 'dotenv';

dotenv.config();

/*
  Scan Aave V3 Arbitrum borrowers via The Graph and filter by HF and debt (USD).
  Env vars (optional):
    GRAPH_API_KEY          - required
    SUBGRAPH_ID            - default: DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B
    HF_MAX                 - default: 1.10
    MIN_DEBT_USD           - default: 300
    BATCH                  - default: 500
    MAX_RESULTS            - default: 2000
*/

const API_KEY = process.env.GRAPH_API_KEY || '';
const SUBGRAPH_ID = process.env.SUBGRAPH_ID || 'DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B';
const HF_MAX = Number(process.env.HF_MAX || '1.10');
const MIN_DEBT_USD = Number(process.env.MIN_DEBT_USD || '300');
const BATCH = Number(process.env.BATCH || '500');
const MAX_RESULTS = Number(process.env.MAX_RESULTS || '2000');

if (!API_KEY) {
  console.error('GRAPH_API_KEY missing in .env');
  process.exit(1);
}

const ENDPOINT = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;

interface UserRow {
  id: string;
  healthFactor: string; // BigDecimal
  totalBorrowsUSD: string; // BigDecimal
  totalCollateralUSD: string; // BigDecimal
}

async function fetchPage(idGt: string | null): Promise<UserRow[]> {
  const where: string[] = ["borrowedReservesCount_gt: 0"]; // has debt
  // Use subgraph-side HF filter to reduce results if field exists
  where.push(`healthFactor_lt: \"${HF_MAX}\"`);
  if (idGt) where.push(`id_gt: \"${idGt}\"`);

  const query = {
    query: `{
      users(first: ${BATCH}, orderBy: healthFactor, orderDirection: asc, where: { ${where.join(', ')} }) {
        id
        healthFactor
        totalBorrowsUSD
        totalCollateralUSD
      }
    }`,
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  const data = await res.json() as any;
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return (data.data?.users || []) as UserRow[];
}

async function main() {
  const out: Array<{ user: string; hf: number; debt: number; collateral: number }> = [];

  let lastId: string | null = null;
  while (out.length < MAX_RESULTS) {
    const rows = await fetchPage(lastId);
    if (rows.length === 0) break;

    for (const r of rows) {
      const hf = Number(r.healthFactor);
      const debt = Number(r.totalBorrowsUSD);
      const coll = Number(r.totalCollateralUSD);
      if (Number.isFinite(hf) && Number.isFinite(debt) && debt >= MIN_DEBT_USD) {
        out.push({ user: r.id, hf, debt, collateral: coll });
        if (out.length >= MAX_RESULTS) break;
      }
    }

    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }

  out.sort((a, b) => a.hf - b.hf);

  console.log(`Found ${out.length} candidates (HF < ${HF_MAX}, debt >= $${MIN_DEBT_USD}). Top 25:`);
  for (const row of out.slice(0, 25)) {
    const status = row.hf < 1.0 ? '🔴' : row.hf < 1.02 ? '🟠' : row.hf < 1.05 ? '🟡' : '🔵';
    console.log(`${status} HF:${row.hf.toFixed(4)} | $${row.debt.toFixed(0)} debt | $${row.collateral.toFixed(0)} coll | ${row.user}`);
  }
}

main().catch(e => {
  console.error('Error:', e.message || e);
  process.exit(1);
});

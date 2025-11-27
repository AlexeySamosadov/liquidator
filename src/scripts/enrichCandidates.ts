import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/*
  Enrich candidate users with main debt/collateral tokens using The Graph (Aave V3 Arbitrum).
  Inputs (if exist):
    - data/aave_candidates.json
    - data/aave_candidates_small.json
  Outputs:
    - data/aave_candidates_enriched.json
    - data/aave_candidates_small_enriched.json
  Progress:
    - data/enrich_progress.json
*/

const API_KEY = process.env.GRAPH_API_KEY || '';
const SUBGRAPH_ID = process.env.SUBGRAPH_ID || 'DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B';
const ENDPOINT = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;

const INPUTS = [
  { in: 'data/aave_candidates.json', out: 'data/aave_candidates_enriched.json' },
  { in: 'data/aave_candidates_small.json', out: 'data/aave_candidates_small_enriched.json' },
];

const STABLES = new Set(
  [
    // Arbitrum
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
    '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', // USDC.e
    '0xfD086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'.toLowerCase(), // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'.toLowerCase(), // DAI
  ]
);

const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'.toLowerCase();
const WSTETH = '0x5979D7b546E38E414F7E9822514be443A4800529'.toLowerCase();

function pLimit(n: number) {
  const q: Array<() => void> = [];
  let a = 0;
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (a >= n) await new Promise<void>((r) => q.push(r));
    a++;
    try { return await fn(); } finally { a--; const nx = q.shift(); if (nx) nx(); }
  };
}

async function gQuery(query: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    try {
      const j = await res.json();
      if (j.errors) throw new Error(JSON.stringify(j.errors));
      return j.data;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      if (attempt === 4) throw e;
    }
  }
}

async function fetchUserReserves(user: string) {
  const q = `{
    userReserves(first: 50, where: { user: "${user.toLowerCase()}" }) {
      usageAsCollateralEnabledOnUser
      scaledATokenBalance
      currentATokenBalance
      scaledVariableDebt
      principalStableDebt
      reserve { underlyingAsset symbol decimals }
    }
  }`;
  const data = await gQuery(q);
  return (data?.userReserves || []) as Array<any>;
}

function pickPair(userReserves: any[]) {
  let bestDebt: any | null = null;
  let bestColl: any | null = null;
  for (const ur of userReserves) {
    const debtRaw = Number(ur.scaledVariableDebt || 0) + Number(ur.principalStableDebt || 0);
    const collRaw = Number(ur.currentATokenBalance || ur.scaledATokenBalance || 0);
    if (debtRaw > (Number(bestDebt?.scaledVariableDebt || 0) + Number(bestDebt?.principalStableDebt || 0))) bestDebt = ur;
    if (ur.usageAsCollateralEnabledOnUser && collRaw > Number(bestColl?.currentATokenBalance || 0)) bestColl = ur;
  }
  if (!bestDebt && userReserves.length) bestDebt = userReserves[0];
  if (!bestColl && userReserves.length) bestColl = userReserves[0];
  if (!bestDebt || !bestColl) return null;
  const debtToken = String(bestDebt.reserve.underlyingAsset).toLowerCase();
  const debtDecimals = Number(bestDebt.reserve.decimals);
  const collToken = String(bestColl.reserve.underlyingAsset).toLowerCase();
  // Heuristic pool fee
  let poolFee = 3000;
  const correlated = (debtToken === WETH && collToken === WSTETH) || (debtToken === WSTETH && collToken === WETH);
  if (correlated) poolFee = 100;
  else if (STABLES.has(debtToken) && STABLES.has(collToken)) poolFee = 100;
  else if (STABLES.has(debtToken) || STABLES.has(collToken)) poolFee = 500;
  return { debtToken, debtDecimals, collToken, poolFee };
}

async function enrichFile(inPath: string, outPath: string, limit = 5000, concurrency = 8) {
  const absIn = path.join(process.cwd(), inPath);
  if (!fs.existsSync(absIn)) return { total: 0, enriched: 0 };
  const raw = fs.readFileSync(absIn, 'utf8');
  const rows = JSON.parse(raw) as Array<{ user: string; hf?: number; debt?: number; collateral?: number }>;
  const users = Array.from(new Map(rows.map(r => [r.user.toLowerCase(), r])).values()).slice(0, limit);

  const limitFn = pLimit(concurrency);
  const out: any[] = [];
  let done = 0;

  for (const u of users) {
    // eslint-disable-next-line no-await-in-loop
    await limitFn(async () => {
      try {
        const reserves = await fetchUserReserves(u.user);
        const pair = pickPair(reserves);
        if (pair) out.push({ ...u, ...pair });
      } catch {}
      done++;
      try {
        fs.writeFileSync(path.join(process.cwd(), 'data/enrich_progress.json'), JSON.stringify({ file: inPath, done, total: users.length, pct: Math.round(done * 100 / users.length), updatedAt: new Date().toISOString() }, null, 2));
      } catch {}
    });
  }

  out.sort((a, b) => Number(a.hf ?? 1e9) - Number(b.hf ?? 1e9));
  fs.writeFileSync(path.join(process.cwd(), outPath), JSON.stringify(out, null, 2));
  return { total: users.length, enriched: out.length };
}

async function main() {
  if (!API_KEY) throw new Error('GRAPH_API_KEY missing');
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
  const results = [] as any[];
  for (const io of INPUTS) {
    // eslint-disable-next-line no-await-in-loop
    const r = await enrichFile(io.in, io.out, Number(process.env.ENRICH_LIMIT || '5000'), Number(process.env.ENRICH_CONCURRENCY || '8'));
    results.push({ in: io.in, out: io.out, ...r });
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => { console.error('Error:', e.message || e); process.exit(1); });

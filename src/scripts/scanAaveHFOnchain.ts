import dotenv from 'dotenv';
import { AaveV3Monitor } from '../services/aave/AaveV3Monitor';
import fs from 'fs';
import path from 'path';

dotenv.config();

/*
  End-to-end scanner:
  - Pulls borrower addresses from The Graph (ids only)
  - For each address, fetches on-chain account data (HF, debt/collateral USD)
  - Filters by HF and minimum debt

  Env (optional):
    GRAPH_API_KEY
    SUBGRAPH_ID (default: DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B)
    ARBITRUM_RPC
    HF_MAX (default 1.12)
    MIN_DEBT_USD (default 300)
    PAGE (default 300)
    LIMIT_USERS (default 5000)
    CONCURRENCY (default 25)
    OUT (default data/aave_candidates.json)
*/

const API_KEY = process.env.GRAPH_API_KEY || '';
const SUBGRAPH_ID = process.env.SUBGRAPH_ID || 'DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B';
const ENDPOINT = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;

const HF_MAX = Number(process.env.HF_MAX || '1.12');
const MIN_DEBT_USD = Number(process.env.MIN_DEBT_USD || '300');
const MAX_DEBT_USD = Number(process.env.MAX_DEBT_USD || '0'); // 0 = no upper cap
const PAGE = Number(process.env.PAGE || '300');
const LIMIT_USERS = Number(process.env.LIMIT_USERS || '5000');
const CONCURRENCY = Number(process.env.CONCURRENCY || '25');
const OUT = process.env.OUT || 'data/aave_candidates.json';

const monitor = new AaveV3Monitor(process.env.ARBITRUM_RPC);

type UserRow = { id: string };

async function fetchIds(idGt: string | null): Promise<UserRow[]> {
  const where = idGt ? `, id_gt: \"${idGt}\"` : '';
  const body = {
    query: `{
      users(first: ${PAGE}, where: { borrowedReservesCount_gt: 0${where} }, orderBy: id) { id }
    }`,
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json() as any;
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return (j.data?.users || []) as UserRow[];
}

function pLimit(n: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>(r => queue.push(r));
    active++;
    try { return await fn(); }
    finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

async function main() {
  if (!API_KEY) throw new Error('GRAPH_API_KEY missing');
  const outDir = path.dirname(OUT);
  fs.mkdirSync(outDir, { recursive: true });

  const TOTAL_HINT = Number(process.env.TOTAL_HINT || '85724');
  const limitTotal = Math.min(LIMIT_USERS, TOTAL_HINT || LIMIT_USERS);
  const started = Date.now();

  const limit = pLimit(CONCURRENCY);
  const results: Array<{ user: string; hf: number; debt: number; collateral: number }> = [];

  let scanned = 0;
  let lastId: string | null = null;
  while (scanned < LIMIT_USERS) {
    const batch = await fetchIds(lastId);
    if (batch.length === 0) break;

    const chunk = batch.slice(0, Math.min(batch.length, LIMIT_USERS - scanned));
    scanned += chunk.length;
    lastId = batch[batch.length - 1].id;

    await Promise.all(chunk.map((row) => limit(async () => {
      try {
        const data = await monitor.getUserAccountData(row.id);
        const hf = Number(data.healthFactor) / 1e18;
        const debt = Number(data.totalDebtBase) / 1e8;
        const coll = Number(data.totalCollateralBase) / 1e8;
        if (hf > 0 && hf < HF_MAX && debt >= MIN_DEBT_USD && (MAX_DEBT_USD === 0 || debt <= MAX_DEBT_USD)) {
          results.push({ user: row.id, hf, debt, collateral: coll });
        }
      } catch {}
    })));

    const elapsed = (Date.now() - started) / 1000; // sec
    const rate = scanned > 0 ? elapsed / scanned : 0;
    const eta = rate && limitTotal ? Math.max(0, Math.round(limitTotal * rate - elapsed)) : 0;
    const pct = limitTotal ? Math.min(100, Math.round((scanned / limitTotal) * 100)) : Math.round((scanned / LIMIT_USERS) * 100);

    console.log(`Scanned: ${scanned}/${limitTotal} (${pct}%) | candidates: ${results.length} | ETA: ${eta}s`);

    // Write progress to JSON file for external monitoring
    try {
      const dir = path.dirname(OUT);
      const progressPath = path.join(dir, 'aave_scan_progress.json');
      fs.writeFileSync(progressPath, JSON.stringify({
        scanned,
        limitTotal,
        pct,
        candidates: results.length,
        eta_sec: eta,
        lastId,
        updatedAt: new Date().toISOString()
      }, null, 2));

      // Persist current candidates snapshot after each batch (incremental)
      const snapshot = [...results].sort((a, b) => a.hf - b.hf);
      fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2));

      // Log brief top-5
      const top5 = snapshot.slice(0, 5)
        .map(r => `HF:${r.hf.toFixed(4)} $${r.debt.toFixed(0)} ${r.user.slice(0,8)}…`)
        .join(' | ');
      console.log(`Top5: ${top5}`);
    } catch {}

    if (batch.length < PAGE) break;
  }

  results.sort((a, b) => a.hf - b.hf);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

  console.log(`\nSaved ${results.length} candidates to ${OUT}`);
  for (const r of results.slice(0, 25)) {
    const s = r.hf < 1.0 ? '🔴' : r.hf < 1.02 ? '🟠' : r.hf < 1.05 ? '🟡' : '🔵';
    console.log(`${s} HF:${r.hf.toFixed(4)} | $${r.debt.toFixed(0)} | ${r.user}`);
  }
}

main().catch(e => { console.error('Error:', e.message || e); process.exit(1); });

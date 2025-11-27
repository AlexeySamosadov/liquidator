import fs from 'fs';
import path from 'path';

export interface CandidateRow {
  user: string;
  hf?: number;
  debt?: number;
  collateral?: number;
}

export function loadCandidates(filePath: string): CandidateRow[] {
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return [];
    const raw = fs.readFileSync(abs, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x?.user === 'string');
  } catch {
    return [];
  }
}

export function pickTopByHF(rows: CandidateRow[], limit: number): CandidateRow[] {
  const copy = [...rows];
  copy.sort((a, b) => (Number(a.hf ?? 9e9) - Number(b.hf ?? 9e9)));
  return copy.slice(0, limit);
}

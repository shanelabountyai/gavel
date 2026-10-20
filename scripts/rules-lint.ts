// rules:lint (task 1.4, CLAUDE.md non-negotiables 1, 6, 7): three checks, exit 1 on the first failure.
//   1. rules/auction.v1.json parses, validates, and its sha256 equals D-23 (loadRules does both).
//   2. Nothing under src/auction/engine/ names Prisma, @/core, @/app, Date.now, new Date, Math.random,
//      process.env, fetch or setTimeout. The service files beside the engine are not scanned.
//   3. No float path under the engine: Math.round, toFixed, parseFloat, a decimal literal, or `/`,
//      except the one bigint `/` in money.ts roundHalfUp (D-31 Q5). Import lines are not counted (D-34).
// Shape after Bracketry eslint.config.mjs's engine block (L-002), as a script so the grep and the hash
// sit in the gate together.
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadRules } from '../src/auction/load-rules';

export const ENGINE_DIR = 'src/auction/engine';

const BANNED: [RegExp, string][] = [
  [/prisma/i, 'Prisma'],
  [/@\/core/, '@/core'],
  [/@\/app/, '@/app'],
  [/\bDate\.now\b/, 'Date.now'],
  [/\bnew\s+Date\b/, 'new Date'],
  [/\bMath\.random\b/, 'Math.random'],
  [/\bprocess\.env\b/, 'process.env'],
  [/\bfetch\b/, 'fetch'],
  [/\bsetTimeout\b/, 'setTimeout'],
  [/\bMath\.round\b/, 'Math.round (float)'],
  [/\.toFixed\b/, 'toFixed (float)'],
  [/\bparseFloat\b/, 'parseFloat (float)'],
  [/\b\d+\.\d+\b/, 'a decimal literal (float)'],
];

/** The `/` each engine file may contain after comments are stripped; absent means zero. */
const SLASHES_ALLOWED: Record<string, number> = { 'money.ts': 1 };

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Problems in one engine source file, as "name: what" lines; empty means clean. */
export function lintEngineSource(name: string, source: string): string[] {
  const code = stripComments(source);
  const problems = BANNED.filter(([re]) => re.test(code)).map(([, what]) => `${name}: ${what}`);
  // Import specifiers ('./money', '@/core/clock') are neither division nor regex: drop them from the count only.
  const slashes = (code.replace(/^\s*import\b.*$/gm, '').match(/\//g) ?? []).length;
  const allowed = SLASHES_ALLOWED[name] ?? 0;
  if (slashes !== allowed) problems.push(`${name}: ${slashes} '/' (division or regex), ${allowed} allowed`);
  return problems;
}

export function lintEngineDir(dir = ENGINE_DIR): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
    .flatMap((d) => lintEngineSource(d.name, readFileSync(`${d.parentPath}/${d.name}`, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { rules, hash } = loadRules(); // throws RulesError on a schema miss or a hash that is not D-23
  const problems = lintEngineDir();
  for (const p of problems) console.error(`rules:lint: ${p}`);
  if (problems.length) process.exit(1);
  console.log(`rules:lint: OK (${rules.bands.length} bands, sha256 ${hash} = D-23, ${ENGINE_DIR} clean)`);
}

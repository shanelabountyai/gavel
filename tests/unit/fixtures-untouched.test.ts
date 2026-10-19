// Task 1.2: product code never reads or writes fixtures/; only auction:eval (a script) does.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('fixtures/ (brief §11)', () => {
  it('is referenced by nothing under src/', () => {
    const hits = readdirSync('src', { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name) && !d.parentPath.includes('generated'))
      .map((d) => `${d.parentPath}/${d.name}`)
      .filter((f) => /fixtures\/|expected_(bids|lots)/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});

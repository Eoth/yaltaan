// Refuses a ROADMAP.md whose progress column (the execution order's `Avancement` cells and the line above the table)
// differs from what its closed table gives; --write recomputes them in place. A count kept by hand drifts the first
// time a ticket closes without it; computed and checked, it cannot.
//
// Usage:
//   node scripts/check-roadmap-progress.ts            the working tree (verify.sh)
//   node scripts/check-roadmap-progress.ts --cached   the index, i.e. the next commit (pre-commit hook)
//   node scripts/check-roadmap-progress.ts --write    recompute the column in the working tree
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withProgress } from './lib/roadmap-progress.ts';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ROADMAP.md');
const mode = process.argv[2];
try {
  if (mode !== undefined && mode !== '--cached' && mode !== '--write') {
    throw new Error(`unknown option ${mode}; usage: check-roadmap-progress.ts [--cached | --write]`);
  }
  const roadmap =
    mode === '--cached'
      ? execFileSync('git', ['show', ':ROADMAP.md'], { cwd: path.dirname(file), encoding: 'utf8' })
      : fs.readFileSync(file, 'utf8');
  const expected = withProgress(roadmap);
  if (mode === '--write') {
    fs.writeFileSync(file, expected);
    console.log('ok: progress recomputed in ROADMAP.md');
  } else if (expected !== roadmap) {
    const before = roadmap.split('\n');
    const changed = expected.split('\n').filter((line, i) => line !== before[i]);
    console.error('error: the progress of ROADMAP.md differs from its closed table; expected:');
    console.error(changed.map((line) => `  ${line.slice(0, 160)}`).join('\n'));
    console.error('Run: node scripts/check-roadmap-progress.ts --write');
    process.exitCode = 1;
  } else {
    console.log('ok: the progress of ROADMAP.md matches its closed table.');
  }
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

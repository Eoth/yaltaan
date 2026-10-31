// Hidden characters in the text files git does not ignore: a bidirectional control, an invisible character or a
// control character other than whitespace, written as it is, makes the code a reviewer reads differ from the code that
// runs (Trojan Source, CVE-2021-42574), and an editor or a tool that decodes `\u` escapes on the way writes one unseen.
// Each must be written as an escape. The characters refused are the ones `findHidden` of @yaltaan/core/string reports,
// whose tests judge it on every code point by the tables of the Unicode Character Database: the check and the library
// follow one rule, and no list is written here.
// Exceptions: none. A tab, a line break or a form feed is whitespace, never reported.
// Blind spots: the files git takes for binary (`git grep -I`), among them any file that holds U+0000, and a character a
// later version of Unicode adds to these properties before the engine running the check knows it.
//
// Usage, from anywhere inside the repository to check:
//   node scripts/check-hidden-characters.ts            # the working tree, untracked files included (verify.sh, CI)
//   node scripts/check-hidden-characters.ts --cached   # the index, i.e. the next commit (pre-commit hook)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findHidden } from '../packages/core/src/string/index.ts';

const mode = process.argv[2];
if (mode !== undefined && mode !== '--cached') {
  console.error(`unknown option ${mode}; usage: check-hidden-characters.ts [--cached]`);
  process.exit(2);
}
const cached = mode === '--cached';
const git = (...args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'] });

const root = git('rev-parse', '--show-toplevel').trim();
let listed = '';
try {
  listed = execFileSync('git', ['grep', cached ? '--cached' : '--untracked', '-I', '-l', '-z', '-e', ''], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
} catch (error) {
  // Exit status 1 only means that no file matched.
  if ((error as { status?: number }).status !== 1) {
    throw error;
  }
}
const files = listed.split('\0').filter((file) => file !== '');

const problems: string[] = [];
for (const file of files) {
  let text: string;
  if (cached) {
    text = git('-C', root, 'show', `:${file}`);
  } else if (existsSync(path.join(root, file))) {
    text = readFileSync(path.join(root, file), 'utf8');
  } else {
    // A file deleted from the working tree but not from the index has nothing left to judge here.
    continue;
  }
  for (const { index, codePoint, kind } of findHidden(text)) {
    const line = text.slice(0, index).split('\n').length;
    const name = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    problems.push(`${file}:${String(line)}: ${name} (${kind}) written as it is: write it as an escape`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }
  console.error('\nerror: the character(s) above are hidden; see the top of scripts/check-hidden-characters.ts.');
  process.exit(1);
}
console.log(`ok: ${String(files.length)} text files: no bidirectional control, invisible or control character.`);

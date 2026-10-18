// The internal packages: workspace packages that are never published and sit outside the dependency graph, imported
// by test files only. ARCHITECTURE.md §6 lists their folders in the `text` block after `INTERNAL_HEADING`, the one
// list every check reads; the checks of published packages skip them.
//
// A document or a heading that is missing gives no internal package rather than a problem: every package is then
// checked as a published one, which fails loudly on a test package instead of letting anything pass unread. A heading
// whose block cannot be read is a problem, since the reader would otherwise guess.
//
// Usage: node scripts/lib/internal-packages.ts   (prints each internal package folder, one per line, for the shell
//                                                 guards)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describeError, repositoryRoot } from './workspace.ts';

export const INTERNAL_DOCUMENT = 'ARCHITECTURE.md';
export const INTERNAL_HEADING = 'Internal packages';

const PACKAGE_NAME = /^[a-z][a-z0-9-]*$/;

export type InternalRead =
  { readonly ok: true; readonly names: ReadonlySet<string> } | { readonly ok: false; readonly problem: string };

export type BlockRead = { readonly ok: true; readonly lines: readonly string[] } | { readonly ok: false };

/** The lines of the first fenced `text` block after the first line of `markdown` that starts with `heading`. */
export function textBlockAfter(markdown: string, heading: string): BlockRead {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  const open = start === -1 ? -1 : lines.findIndex((line, index) => index > start && line.startsWith('```'));
  const close = open === -1 ? -1 : lines.findIndex((line, index) => index > open && line.startsWith('```'));
  if (lines[open] !== '```text' || close === -1) {
    return { ok: false };
  }
  return { ok: true, lines: lines.slice(open + 1, close) };
}

/** Reads the internal package folders from `markdown`, the text of `INTERNAL_DOCUMENT`. */
export function parseInternalPackages(markdown: string): InternalRead {
  if (!markdown.split('\n').some((line) => line.startsWith(INTERNAL_HEADING))) {
    return { ok: true, names: new Set() };
  }
  const block = textBlockAfter(markdown, INTERNAL_HEADING);
  if (!block.ok) {
    return { ok: false, problem: `${INTERNAL_DOCUMENT}: no \`text\` block after the line "${INTERNAL_HEADING}…"` };
  }
  const names = new Set<string>();
  for (const line of block.lines) {
    const name = line.trim();
    if (name === '') {
      continue;
    }
    if (!PACKAGE_NAME.test(name)) {
      return { ok: false, problem: `${INTERNAL_DOCUMENT}: internal package ${JSON.stringify(name)} is not a folder` };
    }
    names.add(name);
  }
  return { ok: true, names };
}

/** Reads the internal package folders of the repository at `root`. */
export function readInternalPackages(root: string): InternalRead {
  const file = path.join(root, INTERNAL_DOCUMENT);
  if (!existsSync(file)) {
    return { ok: true, names: new Set() };
  }
  try {
    return parseInternalPackages(readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, problem: `${INTERNAL_DOCUMENT}: cannot be read (${describeError(error)})` };
  }
}

if (import.meta.main) {
  const read = readInternalPackages(repositoryRoot);
  if (read.ok) {
    for (const name of [...read.names].sort()) {
      console.log(name);
    }
  } else {
    console.error(`error: ${read.problem}`);
    process.exitCode = 1;
  }
}

// Writes gzip-compressed ustar archives for the tests. npm's own tarballs are read as well, but a defect npm never
// writes (a link, an entry cut short, a header that is not octal) can only be fabricated.
import { gzipSync } from 'node:zlib';

export interface FixtureEntry {
  readonly path: string;
  readonly bytes?: Buffer | string;
  /** The ustar type flag: `0` for a file (the default), `2` for a symbolic link, `5` for a folder, `x` for pax. */
  readonly type?: string;
  readonly mode?: number;
  readonly mtime?: number;
}

const BLOCK = 512;

/** One ustar header followed by its content, padded to whole blocks. */
export function tarEntry(entry: FixtureEntry): Buffer {
  const bytes = Buffer.from(entry.bytes ?? '');
  const header = Buffer.alloc(BLOCK);
  const octal = (value: number, length: number): string => `${value.toString(8).padStart(length - 1, '0')}\0`;
  header.write(entry.path, 0, 100, 'utf8');
  header.write(octal(entry.mode ?? 0o644, 8), 100, 'latin1');
  header.write(octal(0, 8), 108, 'latin1');
  header.write(octal(0, 8), 116, 'latin1');
  header.write(octal(bytes.length, 12), 124, 'latin1');
  header.write(octal(entry.mtime ?? 499162500, 12), 136, 'latin1');
  header.write(entry.type ?? '0', 156, 'latin1');
  header.write('ustar\u000000', 257, 'latin1');
  header.write('        ', 148, 'latin1');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  const padding = Buffer.alloc((BLOCK - (bytes.length % BLOCK)) % BLOCK);
  return Buffer.concat([header, bytes, padding]);
}

/** A pax extended header that gives the next entry `path`. */
export function paxPath(path: string): Buffer {
  const record = (length: number): string => `${length} path=${path}\n`;
  let length = record(0).length;
  while (record(length).length !== length) {
    length = record(length).length;
  }
  return tarEntry({ path: 'PaxHeader', type: 'x', bytes: record(length) });
}

/** The archive of `parts` (entries or raw blocks), closed by two zero-filled blocks unless `closed` is false. */
export function writeTarball(parts: readonly (FixtureEntry | Buffer)[], closed = true): Buffer {
  const blocks = parts.map((part) => (Buffer.isBuffer(part) ? part : tarEntry(part)));
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(closed ? 2 * BLOCK : 0)]));
}

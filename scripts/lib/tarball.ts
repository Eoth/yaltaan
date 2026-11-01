// Reads a gzip-compressed tar archive the way `npm pack` writes one, so that the checks judge the bytes a user would
// download rather than a listing of the folder they came from. Only what npm writes is read: regular files, and the
// pax extended headers that carry a path too long for the ustar fields. Any other entry (a directory, a link, a
// device) is a problem: npm writes none, and a reader that skipped one would judge an archive it did not fully see.
import { gunzipSync } from 'node:zlib';

import { describeError } from './workspace.ts';

/** One regular file of an archive, its path as written (`package/dist/index.js`). */
export interface TarEntry {
  readonly path: string;
  /** Permission bits, `0o644` for a file npm packs without its executable bit. */
  readonly mode: number;
  /** Modification time, in seconds since the epoch. */
  readonly mtime: number;
  readonly bytes: Buffer;
}

export type TarballRead =
  { readonly ok: true; readonly entries: readonly TarEntry[] } | { readonly ok: false; readonly problem: string };

const BLOCK = 512;

/** Decompresses and reads `compressed`; the first problem met stops the reading. */
export function readTarball(compressed: Uint8Array): TarballRead {
  let archive: Buffer;
  try {
    archive = gunzipSync(compressed);
  } catch (error) {
    return { ok: false, problem: `not a gzip stream (${describeError(error)})` };
  }
  const entries: TarEntry[] = [];
  let pendingPath: string | undefined;
  for (let offset = 0; offset + BLOCK <= archive.length;) {
    const header = archive.subarray(offset, offset + BLOCK);
    // The archive ends with zero-filled blocks.
    if (header.every((byte) => byte === 0)) {
      return { ok: true, entries };
    }
    const size = readOctal(header, 124, 12);
    const mode = readOctal(header, 100, 8);
    const mtime = readOctal(header, 136, 12);
    if (size === undefined || mode === undefined || mtime === undefined) {
      return { ok: false, problem: `the header at byte ${offset} has a size, mode or date that is not octal` };
    }
    const start = offset + BLOCK;
    if (start + size > archive.length) {
      return { ok: false, problem: `the entry at byte ${offset} claims ${size} bytes past the end of the archive` };
    }
    const bytes = archive.subarray(start, start + size);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
    const type = String.fromCharCode(header[156] ?? 0);
    if (type === 'x') {
      pendingPath = readPaxPath(bytes);
      continue;
    }
    if (type !== '0' && type !== '\0') {
      return { ok: false, problem: `the entry at byte ${start - BLOCK} is of type "${type}", not a regular file` };
    }
    entries.push({ path: pendingPath ?? readUstarPath(header), mode, mtime, bytes: Buffer.from(bytes) });
    pendingPath = undefined;
  }
  return { ok: false, problem: 'the archive ends without its closing zero-filled block' };
}

/** The ustar name, behind its prefix when the archive has one. */
function readUstarPath(header: Buffer): string {
  const name = readString(header, 0, 100);
  const isUstar = header.subarray(257, 262).toString('latin1') === 'ustar';
  const prefix = isUstar ? readString(header, 345, 155) : '';
  return prefix === '' ? name : `${prefix}/${name}`;
}

/** The `path` record of a pax header (`<length> path=<value>\n` records), if it has one. */
function readPaxPath(bytes: Buffer): string | undefined {
  let found: string | undefined;
  for (let offset = 0; offset < bytes.length;) {
    const space = bytes.indexOf(0x20, offset);
    const length = space === -1 ? NaN : Number(bytes.subarray(offset, space).toString('latin1'));
    if (!Number.isInteger(length) || length <= 0) {
      return found;
    }
    const record = bytes.subarray(space + 1, offset + length - 1).toString('utf8');
    if (record.startsWith('path=')) {
      found = record.slice('path='.length);
    }
    offset += length;
  }
  return found;
}

function readString(header: Buffer, start: number, length: number): string {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

function readOctal(header: Buffer, start: number, length: number): number | undefined {
  const text = readString(header, start, length).trim();
  return /^[0-7]+$/.test(text) ? Number.parseInt(text, 8) : undefined;
}

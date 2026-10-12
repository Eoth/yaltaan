// Runs a repository script inside a throwaway git repository, so that a guard is judged on files a test writes, never
// on the real repository.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot: string = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * The bash to run repository scripts with. On Windows a bare `bash` may resolve to WSL's launcher in System32, which
 * runs in another file system and sees no Windows path: Git for Windows' own bash is found next to `git` instead.
 */
export function bashPath(): string {
  if (process.platform !== 'win32') {
    return 'bash';
  }
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim();
  // <git>/mingw64/libexec/git-core -> <git>/bin/bash.exe
  const candidate = path.resolve(execPath, '..', '..', '..', 'bin', 'bash.exe');
  if (!fs.existsSync(candidate)) {
    throw new Error(`Git for Windows' bash not found at ${candidate}`);
  }
  return candidate;
}

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A throwaway repository holding the given files (path -> content), all staged, removed by `dispose`. */
export class FixtureRepo {
  readonly dir: string;

  constructor(files: Readonly<Record<string, string>>) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-test-'));
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'core.autocrlf', 'false');
    this.git('config', 'user.name', 'test');
    this.git('config', 'user.email', 'test@localhost');
    this.write(files);
  }

  write(files: Readonly<Record<string, string>>): void {
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(this.dir, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    this.git('add', '-A');
  }

  git(...args: string[]): string {
    const result = spawnSync('git', args, { cwd: this.dir, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  /** Copies a repository script into the fixture (scripts locate the repository from their own path) and runs it. */
  run(script: string, ...args: string[]): RunResult {
    const target = path.join(this.dir, script);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, script), target);
    const result = spawnSync(bashPath(), [script, ...args], { cwd: this.dir, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  dispose(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Runs `body` on a fixture repository holding `files`, and always removes it. */
export function withRepo<T>(files: Readonly<Record<string, string>>, body: (repo: FixtureRepo) => T): T {
  const repo = new FixtureRepo(files);
  try {
    return body(repo);
  } finally {
    repo.dispose();
  }
}

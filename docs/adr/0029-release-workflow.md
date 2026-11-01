# ADR 0029 — Release workflow: rehearsal, trusted publishing, inspected and reproducible tarballs

- Date: 2026-11-01
- Status: accepted

## Context

ARCHITECTURE.md §11 promises publishing through trusted publishing (OIDC) with npm provenance, an SBOM with every release, `publint` and `arethetypeswrong` in CI, and an inspection of the actual content of the published tarball. CONTRIBUTING.md forbids any npm token in the repository or the CI. Nothing is published before this workflow exists and the owner's trademark searches are done (ADR 0001): the workflow must be provable without publishing anything.

Until now the gate listed what `npm pack --dry-run` would ship and judged each path against a written list (`.test.`, `/tests/`, `/fixtures/`, `/src/`, an allowlist of extensions under `dist/`). A file named otherwise, an unreachable module compiled into `dist/`, or a module missing from the tarball passed. A list written by hand only covers what its author imagined.

## Options

1. **Native, or do nothing.** Publish by hand from a laptop with `npm publish`: a long-lived token or an interactive login, no provenance, nothing checked between the commit and the registry. Rejected: it breaks two promises of §11.
2. **A third-party release tool** (changesets, semantic-release, release-please). Each brings its own versioning model and tens of packages, and decides the version from commit messages or change files; none inspects the tarball. Rejected: the parts we need are a few npm commands and checks that our scripts can hold.
3. **A workflow of our own over npm's own commands**, every check in a script the gate and a local rehearsal run as well. Kept, in the shape below.

For the judges of the tarball, ADR 0030 weighs `arethetypeswrong`; `publint` is weighed here, being light.

1. **No linter of the manifest but ours** (`check-manifests.ts`). Costs nothing; every rule of packaging that we did not think of (condition order, a field bundlers read and Node ignores) stays unjudged.
2. **publint 0.3.25 as a development dependency**, run through its API on the bytes of the real tarball. Kept: an external rule base for what bundlers and Node read, at a light cost (below).

## Measurements

On 2026-11-01, Ubuntu 26.04 x64, Node 24.21.0, npm 11.19.0:

- **`npm pack` is reproducible as it stands**: every entry dated 1985-10-26 08:15 UTC, owner 0/0, mode 0644, a gzip header without a date; two packs of `packages/core`, the second after `touch` on a built file, give the same SHA-256 (`61be5de1…abd198`).
- **`npm sbom`** (npm's own command, CycloneDX 1.5) gives the right component only when run from a folder laid out as `node_modules/@yaltaan/core`: run from the workspace it describes the workspace root (`yaltaan-workspace`), and fails outright while the root has no version (`EINVALIDPURLTYPE`); run from the folder `npm pack` extracts to (`package/`), it names the component `package`.
- **npm refuses a private package only when it really publishes**: `libnpmpublish` throws `EPRIVATE` before anything else, while `npm publish --dry-run` of a private tarball exits 0. The rehearsal therefore cannot lean on npm for that rule: the release script checks it.
- **publint 0.3.25** (2026-10-01, MIT, signed by the registry and published with provenance): 7 lock entries (publint, `@publint/pack`, `sade`, `mri`, `picocolors`, `tinyexec`, `package-manager-detector`), MIT 6 and ISC 1, no install script, 254 200 bytes on disk (`du -sb`); four entries carry provenance; 26 releases of the 0.3 line since 2025-01-06. Through its API with `pack: { tarball }` it reads the bytes it is given and spawns no process. On the tarball of `@yaltaan/core`: no message, 6 ms. On a tarball fabricated with `types` after `default`, an export and a `module` field naming absent files: five errors, each one of the defects.

## Decision

**One version, one tag.** Every published package carries the same version; a release is the annotated tag `v<version>` on a commit of `main`. The commit that prepares it (`node scripts/release-prepare.ts <version>`) sets the version of every published package and the specs of the workspace dependencies, removes `private`, and moves the `Unreleased` entries of CHANGELOG.md under `## [<version>] - <date>`.

**Consistency checked before anything is built** (`scripts/release.ts`): the tag is annotated, points at the checked-out commit, and names a SemVer version; every published package carries that version, is not private (except in a rehearsal), declares the repository the workflow runs from (`repository.url` and its `directory`, which npm compares with the provenance) and `publishConfig` with public access and provenance; the CHANGELOG section of the version exists right below `Unreleased`, is not empty, and is dated with the release commit's author or committer date (an amend or a rebase on a later day keeps the first).

**The tarball is judged by what the code reaches, not by a list.** For each package, the real tarball is read (gzip and tar, by the script), and its expected content is computed from the package itself: the targets of every condition of `exports`, then every module they import, followed through the built JavaScript (Rollup's parser, as the graph check of ADR 0011) and through the declarations (TypeScript 7 loads and checks them from the types targets, `--listFiles`; only the declaration files it loads count, since the emitted declarations import `./x.ts` and a source shipped beside them would be loaded in their place), plus the files npm adds whatever `files` says (`package.json`, `README.md`, `LICENSE`). The declaration file of a module the JavaScript reaches counts as reached: TypeScript emits one per module, and leaving out those no public declaration imports (`dist/object/mask.d.ts`, 1 174 bytes, the internal helpers of the masks) would take a list of internal modules written into `files` by hand. A file of the tarball that nothing reaches is refused, whatever its name; a relative import whose target is missing, or declarations that do not compile, are refused; the licence must equal the repository's. publint judges the same bytes.

**Reproducible archives.** The release script builds every package from nothing twice, in two folders with different paths, packs both, and requires the tarballs to be identical to the byte; the SHA-512 of each tarball is printed in the integrity format of npm, in the log and as a notice of the workflow run, so that a rehearsal on another machine can be compared with it.

**A consumer's view.** The tarballs are installed offline into an empty project; every subpath of `exports` is loaded by Node through `import` and through `require` (Node ≥ 22.12 loads ES modules by `require`, ADR 0006), and an importer of every subpath is compiled by TypeScript 7.0.2 and 6.0.3 under `nodenext` and under `bundler` resolution.

**SBOM.** One CycloneDX file per package, made by `npm sbom` from the tarball extracted as `node_modules/<name>`; the script checks its component (name, version, purl, licence) and that its components are the package's dependencies.

**Rehearsal is the default.** `scripts/release-rehearsal.sh` clones the repository into a temporary folder, prepares a release commit for a test version (`<next minor>-rehearsal.0`), tags it, runs every check of the release on that tag, and ends with `npm publish --dry-run` of each tarball. The gate runs it on the working tree, the workflow `.github/workflows/release.yml` on every push to `main`, every pull request to `main` and on demand. On a tag, the workflow runs the same checks on the tag; the release script itself treats a `-rehearsal.N` version as a rehearsal. `scripts/release-verdict.sh` decides whether to publish: only a pushed tag (not a manual run started from a tag) whose `release.json` says, as the boolean `false`, that it is no rehearsal; its tests run it on every event, kind of ref and description.

**Publishing without a token.** The publishing job is the only one of the workflow with `id-token: write`, runs in the GitHub environment `npm`, installs nothing and runs no code of ours or of a dependency: it refuses by itself any event but a pushed tag, downloads the files the checking job made, compares them with the SHA-512 sums that job passed as an output (every file of the folder: tarballs, SBOMs, notes, release.json), and runs `npm publish <tarball> --provenance --access public` (dist-tag `next` for a prerelease). npm exchanges the OIDC token for a short-lived publish credential (trusted publishing, npm ≥ 11.5.1). No secret but the workflow's own `GITHUB_TOKEN` appears in a workflow, `setup-node` is never given a `registry-url` (it would write a token line into `.npmrc`), and the gate refuses both. A GitHub release, with the CHANGELOG section, the tarballs, their sums and the SBOMs, follows a successful publication, after the same comparison of the sums.

**publint** enters the gate and the release as a development dependency of the root, called only through its API on tarball bytes. ISC, the licence of `picocolors` in its tree, joins the licences the lock check admits: a permissive licence equivalent to MIT, as CONTRIBUTING.md requires.

## Consequences

- Before the first real release the owner configures, outside the repository: the npm organisation `@yaltaan`, a trusted publisher for each package (this repository, `release.yml`, environment `npm`), and the environment `npm` on GitHub with a required reviewer and deployments limited to the tags `v*`. Until then a real tag fails at `npm publish` (no credential), and a package left private fails at `EPRIVATE`.
- npm configures a trusted publisher only for a package that already exists on the registry (the reference of `npm trust` says so, and npm has no pending publisher for a new name, unlike PyPI). The name of each new package is therefore created once from a machine, by the owner, with an interactive login and two-factor authentication, no token kept. Recommended, for the owner to decide since it publishes: a placeholder version that holds a README and no code (`0.0.0-reserved.0`, dist-tag `reserved`), so that every version with code, 0.1.0 included, leaves from the workflow with its provenance.
- The gate packs every published package for real and follows its imports (0.35 s for one package), and runs the full rehearsal on its working tree (clone, two builds, consumer project, two compilers, npm's dry run: 2.5 s).
- `node_modules` grows by 254 200 bytes; the lock by 7 entries.
- What the inspection does not see: a file the code really imports, whatever it holds (a test helper imported by production code ships, as it must for the import to work; the dependency graph check and the review catch that import); the content of a reached file beyond its imports. The SBOM is checked by our script, not by a CycloneDX validator, and is not tied to the hash of its tarball. The SBOM of a package with dependencies needs them present beside it: the script then fails rather than write an incomplete file. The reproducibility check proves one machine reproduces itself; the sums printed by the workflow are what another machine compares with.

## Review condition

A second package published (independent versions may then be worth their cost); npm changing what `npm pack` dates or orders; publint unmaintained (no release for a year) or a release that spawns processes when given a tarball; trusted publishing replaced by another mechanism.

# Node.js and pnpm toolchain audit — October 25, 2026

Base: `main` at `e607648`. Scope: toolchain configuration, CI, build compatibility and setup documentation. No application feature changes, remote migrations, secret changes, merge or deployment are part of this work.

## Findings and selection

| Area | Before | After |
|---|---|---|
| Project Node requirement | No `engines.node` | `^24.22.1` (at least 24.22.1, below 25) |
| CI Node selection | `node@24` in check, e2e and staging deploy jobs | `node@` plus `engines.node` from the checked-out package.json |
| pnpm | Exact `pnpm@12.3.4` | Exact `pnpm@12.15.0`, same major |
| Package manager mechanism | Pinned `pnpm/setup` v2.0.0 action; no required Corepack setup | Same action and commit, Corepack-compatible manifest for local use |
| Lockfile | Two YAML documents: pnpm bootstrap and application dependencies | Only pnpm bootstrap changes; application dependency document unchanged byte-for-byte |
| Version manager files | No `.nvmrc`, `.node-version`, Volta or project Node pin | None added |
| Deployment runtime | Cloudflare Workers (`cloudflare_module`), D1/R2; local/e2e use Node and SQLite | Unchanged |

Node's [release page](https://nodejs.org/en/blog/release/v24.22.1) identifies **24.22.1**, released October 21, as the latest patched Node 24 LTS at this review. The [release status](https://nodejs.org/en/about/previous-releases) identifies Node 24 and 22 as LTS, Node 26 as Current, and Node 20 and older as EOL. Node 24 is the existing CI major and meets the installed dependencies' requirements. Another major is unnecessary. `^24.22.1` establishes a security floor while permitting later Node 24 updates.

The [pnpm 12.15.0 release](https://pnpm.io/blog/releases/12.15.0) includes a security check rejecting registry metadata for the wrong package; previously that mismatch could evade the requested package's build-script approval rules. Earlier cumulative [12.7 security fixes](https://pnpm.io/blog/releases/12.7#security) also harden script approval, store isolation, shims and project `userAgent` handling. Upgrading the existing pnpm major is warranted without changing application dependencies. These are upstream security fixes, not evidence that this repository was exploited. Applicability of specific attacks depends on registry input, configuration and platform.

## Confirmed and potential security risks

- **Confirmed configuration gap:** no repository Node requirement; the starter README offered npm, Yarn and Bun as interchangeable setup paths despite CI and the lockfile using pnpm. Local installations could drift from CI. README and the development guide now describe one manifest-based contract.
- **Confirmed upstream affected versions:** the [October Node security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) fixes DNS NUL truncation, TLS hostname verification, Brotli memory corruption and other runtime issues in supported Node lines. Node 24 before 24.22.1 does not contain that release's fixes. Selected Node 24.22.1 contains them.
- **Potential repository exposure:** CI's previous `node@24` could already resolve the patched release, but did not encode a minimum patch. Earlier repository evidence mentions Node 24.21; it is historical evidence, not proof of today's runner version. The user's Windows installation and past CI execution binaries were not inspected. No active EOL Node version or successful exploit was confirmed.
- **Build hosts versus Workers:** these Node vulnerabilities matter to affected Node processes in local development, tests and build tooling where the vulnerable APIs/inputs are reached. The deployed app uses Cloudflare's runtime, including its own Node compatibility implementations. Installing a new Node binary locally does not patch Workers or establish exploitability there.
- **Package dependency audit:** the initial audit returned 13 findings: 2 low, 6 moderate, 3 high and 2 critical. All high/critical findings were suppressed by the repository's existing `auditConfig.ignoreGhsas` policy, so `pnpm audit --audit-level high` exited successfully. This is a policy-qualified pass, not a clean dependency graph. The existing ignore list and overrides were preserved.
- **Remaining dependency findings:** the unignored findings include Nuxt 4.6.1 [route-rule case handling](https://github.com/nuxt/nuxt/security/advisories/GHSA-vjh5-4x84-xrqp) and [server-island sanitisation](https://github.com/nuxt/nuxt/security/advisories/GHSA-xfq5-w38q-pc2x), Vitest mocker issues, and lower-severity esbuild/serialization issues. These are distinct from the Node runtime update; updating unrelated application/test dependencies was excluded by the task. Their actual production reachability was not established by this toolchain audit. Review them separately before describing the whole application as vulnerability-free.

## Compatibility evidence

Exact versions resolved from the application lockfile, rather than package.json ranges:

| Component | Locked version | Declared Node engine | Node 24.22.1 |
|---|---|---|---|
| Nuxt | 4.6.1 | `^22.22.3 || ^24.15.0 || >=26.0.0` | Satisfied |
| Nitro | 2.13.4 | `^20.19.0 || >=22.12.0` | Satisfied |
| Vite | 8.3.4 | `^20.19.0 || >=22.12.0` | Satisfied |
| Wrangler | 4.141.0 | `>=22.0.0` | Satisfied |
| pnpm | 12.15.0 | Native executable; npm wrapper permits Node 24 | Satisfied |

An engine scan of the original lockfile found 821 Node declarations. The only nonmatching declaration was the optional Windows **ia32** Sharp binary (`^20.9.0`), excluded on Linux x64 and Windows x64/ARM64. This does not justify using EOL Node 20 or a 32-bit Windows Node installation. The [pnpm installation documentation](https://pnpm.io/installation) supports Node 24 and Windows x64/ARM64; use the appropriate 64-bit Node installer.

The existing setup action was checked at its immutable [action definition](https://github.com/pnpm/setup/blob/c9883cc79df532ad1a7b81bf9ab944ceb090d65c/action.yml) and [README](https://github.com/pnpm/setup/blob/c9883cc79df532ad1a7b81bf9ab944ceb090d65c/README.md). It supports Node semver ranges, reads pnpm from `packageManager`, installs the selected runtime and performs dependency installation with CI's frozen lockfile. It does not read `engines.node` itself, so three small `jq` steps pass that field explicitly. `jq` is available on the existing Ubuntu runners. Job triggers, action hashes, caches, heap settings, staging deployment sequencing and production promotion behavior remain unchanged. GitHub's own action execution runtimes are managed by GitHub, independently of the application's selected Node.

Corepack's exact `packageManager` mechanism remains supported. On this host, Corepack 0.34.6 successfully selected both the old pnpm 12.3.4 and new 12.15.0 pins. Root `engines.node` is a requirement declaration, not a Node installer: isolated pnpm 12.3.4 and 12.15.0 probes accepted an incompatible root Node requirement even with strict engine checking. No misleading enforcement setting, custom preinstall guard or second runtime declaration was added. Check the local Node version; CI selects the declared range explicitly.

## Cloudflare findings and manual action

The checked-in pipeline builds the staging Worker on **GitHub Actions**, then invokes Wrangler. No dashboard Node setting is necessary for that path. No live dashboard build settings were inspected or modified. Production configuration/deployment was not exercised.

For an independently enabled **Workers Builds** integration, [Cloudflare documents](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) a default Node 24.21.0, selection through `NODE_VERSION` or version files, and pnpm selection through exact `packageManager`. Do not assume `engines.node` selects its build image. Set **Settings → Build → Build Variables and Secrets → `NODE_VERSION=24.22.1`**, or a later patched Node 24 satisfying the manifest, for every applicable build environment. Remove or align conflicting `PNPM_VERSION` overrides. This is conditional manual action for a separate integration; do not add build-time selectors to Worker runtime `vars`. Pages, if separately enabled, has its own build settings. See [operations](../server/operations.md#build-toolchain).

The Nuxt source compatibility date remains `2025-07-15`. Worker compatibility dates, flags, bindings, secrets, cron triggers and deploy scripts are unchanged. A build or Wrangler dry run does not deploy or prove live production runtime behavior.

## Files changed

| File | Reason |
|---|---|
| `package.json` | Declare patched Node 24 range; pin pnpm 12.15.0 with upstream security fixes |
| `pnpm-lock.yaml` | Regenerate only pnpm bootstrap metadata and platform binaries for the new pin |
| `.github/workflows/ci.yml` | Read Node requirement from package.json in all three setup jobs |
| `README.md` | Replace starter instructions with project setup, Windows/Corepack steps and build-only commands |
| `docs/guides/development.md` | Own the toolchain convention and verification requirements |
| `docs/server/operations.md` | Distinguish build Node, Workers runtime and conditional dashboard settings |
| `docs/decisions.md`, `docs/decision-index.md` | Record and index D205 |
| `docs/progress.md`, `docs/current-state.md` | Track the change and actual verification evidence |
| This report | Preserve audit findings, primary sources and verification limits |

## Verification

All final checks below used **Node 24.22.1 / pnpm 12.15.0**, selected through Corepack 0.34.6 on Linux x64. Windows instructions are documented, not executed on the user's PC.

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed; lockfile policy checks passed; no application dependency resolution changes |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test:unit` | Passed: 141 files, 1,956 tests; 1 existing skip |
| `pnpm audit --audit-level high` | Exit 0 under existing policy: 8 unignored findings (2 low, 6 moderate), 5 ignored (3 high, 2 critical) |
| `pnpm build` | Passed: production-mode `node-server` build, 53.6 s |
| `pnpm build:staging` | Passed: `cloudflare-module` Worker build, 58.1 s, same 4 GB heap setting as CI |
| `pnpm exec wrangler deploy --dry-run --config .output/server/wrangler.json --outdir /tmp/nuk-toolchain-worker-dry-run` | Packaging passed; dry run exited without deployment or remote migrations |
| Node security smoke probes | DNS NUL input rejected; DNS-only certificates refused for five noncanonical/fullwidth IP spellings, without network requests |
| Manifest/workflow checks | YAML parsed; all three setup jobs use the manifest's Node range; triggers unchanged; version extraction returned `node@^24.22.1` |
| Lockfile/source checks | Application lockfile document unchanged byte-for-byte; pnpm security exceptions and Nuxt/Workers source configuration unchanged; `git diff --check` passed |
| Local browser suite | Blocked by environment: `pnpm test:e2e --bail=1` built and started the seeded server, but Chrome was absent. 58 files reported browser setup failures and all 717 cases were skipped; no passing browser evidence |
| GitHub Actions | Full check/e2e jobs run on the review PR; use its current checks for runner evidence. PRs do not deploy |

The Chromium installation attempt failed repeatedly because its downloaded archive was empty/truncated. No test assertion was weakened or browser setup changed in the repository. The workspace also had a global pnpm 11 fallback: a temporary Corepack shim outside the repository was put on PATH for the final Worker build and dry run so nested pnpm commands used 12.15.0. The initial local e2e attempt's nested build used that global fallback; its result remains environment-blocked, not accepted final-toolchain browser evidence. CI installs native pnpm directly on PATH and does not use this workspace fallback.

Builds emitted dependency warnings (including deprecated exports and top-level `this`), but completed. No unrelated dependency changes were made to silence them. The generated Worker keeps `compatibility_date: 2025-07-15` and flags `nodejs_compat`, `no_nodejs_compat_v2`. No production deployment, live Worker request validation or production configuration inspection was performed.

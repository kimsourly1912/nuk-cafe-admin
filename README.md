# NUK Cafe

One Nuxt full-stack application for customer ordering, cafe administration, the counter and the platform console. Deployed environments run on Cloudflare Workers with D1 and R2; local development uses Node.js and SQLite.

## Toolchain and setup

The source of truth is [`package.json`](package.json):

- `engines.node`: Node.js **24.22.1 or newer within Node 24** (`^24.22.1`).
- `packageManager`: exactly **pnpm 12.15.0**.

Install a matching Node.js release from [Node.js downloads](https://nodejs.org/en/download). The minimum includes the [October 21, 2026 security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). Keep Node 24 patched as new security releases arrive.

### Windows 11 (PowerShell)

Install the Node 24 Windows installer matching your CPU, then reopen VS Code and its terminal so PATH is refreshed. Inside the cloned repository:

```powershell
node --version
corepack enable pnpm
pnpm --version
pnpm install --frozen-lockfile
pnpm dev
```

`node --version` must satisfy `engines.node`; `pnpm --version` must match `packageManager`. Corepack reads the pnpm pin automatically. If enabling its shim is denied in the protected Node installation directory, run `corepack enable pnpm` once in an Administrator terminal, then use an ordinary terminal for development. If Corepack is missing or reports a signature error, follow its [installation instructions](https://github.com/nodejs/corepack#installation) to install/update it.

If the wrong executable is selected, inspect `Get-Command node, pnpm -All` and correct the old installation or PATH entry. Avoid overlapping global pnpm installations and Corepack shims. These package.json declarations do **not** install or automatically switch your computer's Node.js version. If other projects need different Node majors, use a Windows-compatible version manager and select a version satisfying each project's manifest; no extra version file is required by this repository.

The same Corepack and pnpm commands work on other supported systems after installing Node 24. The repository also supports a directly installed pnpm matching `packageManager`; CI uses the existing pinned `pnpm/setup` action rather than Corepack.

## Development and checks

```bash
pnpm dev                      # http://localhost:3000
pnpm lint
pnpm typecheck
pnpm audit --audit-level high
pnpm test:unit
pnpm test:e2e                 # needs Google Chrome; see the development guide
pnpm build                   # production-mode local Node build
pnpm build:staging           # Cloudflare Worker build only; does not deploy
```

See the [development guide](docs/guides/development.md) for testing and first-admin setup, [operations](docs/server/operations.md) for environment configuration, and the [toolchain audit](docs/reviews/toolchain-audit-2026-10-25.md) for security findings and Cloudflare build settings. Never use `deploy:staging` for a build-only check: it also applies remote migrations and deploys.

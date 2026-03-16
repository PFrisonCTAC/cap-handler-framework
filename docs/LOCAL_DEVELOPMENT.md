# Local Development Workflow

This guide explains how to develop and test the `cap-handler-framework` locally inside a **monorepo** alongside a CAP application — **without publishing to npm**.

---

## Repository layout

```
my-monorepo/
├── package.json                    ← root scripts (concurrent dev commands)
├── cap-handler-framework/          ← the framework (TypeScript library)
│   ├── package.json
│   ├── src/                        ← TypeScript source
│   └── dist/                       ← compiled output (loaded at runtime)
└── my-cap-project/                 ← your CAP application
    ├── package.json
    ├── .npmrc
    └── node_modules/
        └── cap-handler-framework  → symlink to ../../cap-handler-framework
```

---

## How the `file:` dependency works

In `my-cap-project/package.json`:

```json
{
  "dependencies": {
    "cap-handler-framework": "file:../cap-handler-framework"
  }
}
```

npm 7+ creates a **symlink** (not a copy):

```
my-cap-project/node_modules/cap-handler-framework → ../../cap-handler-framework
```

Any change you compile to `dist/` is **immediately** visible to the CAP project.  
No `npm install` needed after each build.

---

## Critical: one `@sap/cds` instance

Because the framework lives in a sibling directory (symlink), Node.js would normally
resolve `@sap/cds` relative to the **real path** of the framework files:

```
cap-handler-framework/node_modules/@sap/cds   ← dev tools only
```

…instead of the CAP project's runtime copy:

```
my-cap-project/node_modules/@sap/cds          ← runtime instance
```

Two different instances of `@sap/cds` cause the following error at startup:

```
Error: @sap/cds was loaded from different locations
```

**The fix** — all framework source files resolve `@sap/cds` via `process.cwd()`:

```typescript
// Instead of:  import cds from '@sap/cds'  (resolves from real/symlink path)
// We use:
import type CDS from '@sap/cds';
const cds: typeof CDS = require(
  require.resolve('@sap/cds', { paths: [process.cwd()] })
);
```

`process.cwd()` is the directory from which `cds watch` was started (your CAP project root).
This resolves to `my-cap-project/node_modules/@sap/cds` — the **same** instance as the server.

The `cap-handler-framework/node_modules/@sap/cds` is used **only** by `tsc` for type-checking
and is **never** loaded at runtime.

---

## Module layout reference

| Path | Purpose | Loaded at runtime? |
|------|---------|-------------------|
| `my-cap-project/node_modules/@sap/cds` | THE runtime instance | ✅ Both server and framework |
| `cap-handler-framework/node_modules/@sap/cds` | TypeScript compilation only | ❌ Bypassed by `require.resolve` |
| `root/node_modules/@sap/cds` | Should **not** exist | ❌ Would cause conflicts |
| `my-cap-project/node_modules/cap-handler-framework` | Symlink → framework src | ✅ Live dev link |

---

## One-time setup

```bash
# 1. Install the framework's own dev tools (TypeScript compiler, @sap/cds types)
cd cap-handler-framework
npm install

# 2. Build the framework once
npm run build

# 3. Install the CAP project (creates the file: symlink automatically)
cd ../my-cap-project
npm install
```

> **`.npmrc` tip:** Add `legacy-peer-deps=true` to `my-cap-project/.npmrc`.  
> This prevents npm from hoisting or duplicating packages when it processes
> the `file:` dependency. Without this, you may see duplicate `@sap/cds` errors.

---

## Daily development workflow

You need **two terminals** running at the same time:

### Terminal 1 — Framework watcher

```bash
cd cap-handler-framework
npm run watch
# tsc --watch recompiles dist/ on every .ts save
```

### Terminal 2 — CAP dev server

```bash
cd my-cap-project
cds-ts watch          # or: npm run cds:ts:watch
```

When the framework recompiles (`dist/` changes), `cds watch` picks up the change
(through the symlink) and restarts the server automatically.

---

## Single-command dev (from repo root)

Add a convenience script in the root `package.json`:

```json
{
  "scripts": {
    "dev": "concurrently \"npm run watch --prefix cap-handler-framework\" \"npm run cds:ts:watch --prefix my-cap-project\""
  },
  "devDependencies": {
    "concurrently": "^8.0.0"
  }
}
```

Then:

```bash
npm install   # at repo root
npm run dev   # starts both watchers
```

---

## Verifying the setup

```bash
# 1. Confirm only ONE @sap/cds exists at runtime (no root-level copy):
find . -path "*/node_modules/@sap/cds/package.json" \
       -not -path "*/node_modules/*/node_modules/*" \
       -not -path "*/gen/*"
# Expected:
#   ./my-cap-project/node_modules/@sap/cds/package.json      ← runtime ✅
#   ./cap-handler-framework/node_modules/@sap/cds/package.json ← tsc only ✅
# NOT expected:
#   ./node_modules/@sap/cds/package.json                     ← conflict ❌

# 2. Symlink exists:
ls -la my-cap-project/node_modules/cap-handler-framework
# lrwxr-xr-x ... -> ../../cap-handler-framework  ✅

# 3. Framework dist/ was compiled:
ls cap-handler-framework/dist/core/
# HandlerRegistry.js  BaseHandler.js  ...
```

---

## How changes propagate

```
Edit src/core/HandlerRegistry.ts
  → tsc --watch detects save
  → recompiles to dist/core/HandlerRegistry.js
  → cds-ts watch detects change in (symlinked) dist/
  → Server restarts
  → New logic is active ✅
```

---

## Switching between local dev and npm-published version

### Currently using local (file:) dependency

```json
"cap-handler-framework": "file:../cap-handler-framework"
```

### Switch to published npm version

1. Edit `my-cap-project/package.json`:

   ```json
   "cap-handler-framework": "^1.1.0"
   ```

2. Reinstall:

   ```bash
   cd my-cap-project
   npm install
   ```

3. The symlink is replaced by a real copy from the npm registry.  
   You no longer need the framework watcher running.

### Switch back to local

1. Edit `package.json` back to `"file:../cap-handler-framework"`
2. Run `npm install` to recreate the symlink
3. Restart the framework watcher (`npm run watch` in `cap-handler-framework/`)

---

## Publishing a new version

```bash
cd cap-handler-framework
npm run build          # compile latest src → dist
npm version patch      # bump version (or minor / major)
npm publish            # publish to npm registry
```

Then update the consuming project:

```bash
cd my-cap-project
npm install cap-handler-framework@latest
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `@sap/cds loaded from different locations` | Two `@sap/cds` instances | Check no root-level `node_modules/@sap/cds`; run `npm install` from cap project only |
| Handler changes not picked up | Old `dist/` | Run `npm run build` in `cap-handler-framework/`; touch a project file to force reload |
| `index.ts` not regenerated | `cds-plugin.js` not sharing cds singleton | Ensure `require.resolve('@sap/cds', { paths: [process.cwd()] })` is used in the plugin |
| Symlink missing | `npm install` not run | Run `npm install` in `my-cap-project/` |
| `Module not found` | `dist/` missing | Run `npm run build` in `cap-handler-framework/` |

---

## Useful commands

| Command | Directory | Description |
|---------|-----------|-------------|
| `npm install` | `cap-handler-framework/` | Install dev tools for TypeScript |
| `npm run build` | `cap-handler-framework/` | One-time TypeScript build |
| `npm run watch` | `cap-handler-framework/` | Continuous compilation |
| `npm install` | `my-cap-project/` | Install runtime deps + create symlink |
| `cds-ts watch` | `my-cap-project/` | Start CAP dev server |
| `npm run dev` | repo root | Run both watchers concurrently |

# Local Development Workflow

This document describes how to develop and test the handler framework locally — **without publishing to npm**.

---

## Repository structure

```
kreglinger/                          ← monorepo root (no workspaces)
├── package.json                     ← root scripts only (no workspaces)
├── cap-handler-framework/           ← the framework (TypeScript library)
│   ├── package.json
│   ├── node_modules/                ← framework's OWN dev tools (tsc, @sap/cds types)
│   ├── src/
│   └── dist/                        ← compiled output (loaded at runtime)
└── KreglingerOfferteTool/           ← the CAP application
    ├── package.json
    ├── .npmrc
    └── node_modules/                ← ALL runtime deps including @sap/cds
        └── cap-handler-framework/  → symlink to ../../cap-handler-framework
```

---

## Key design principle: one `@sap/cds` instance

The framework uses `@sap/cds` in its source code (`BaseHandler`, `HandlerContext`).

In a symlinked development setup, Node.js would normally resolve `@sap/cds` relative to the
**real path** of the framework files (`cap-handler-framework/node_modules/@sap/cds`), which is
a different instance than the one loaded by the CAP server
(`KreglingerOfferteTool/node_modules/@sap/cds`). This triggers:

```
ERROR: @sap/cds was loaded from different locations
```

**The fix (in `BaseHandler.ts` and `HandlerContext.ts`):**

```typescript
// Instead of: import cds from '@sap/cds'  ← resolves from real path
// We use:
import type CDS from '@sap/cds';
const cds: typeof CDS = require(
  require.resolve('@sap/cds', { paths: [process.cwd()] })
);
```

`require.resolve('@sap/cds', { paths: [process.cwd()] })` explicitly finds `@sap/cds`
starting from `process.cwd()` (= `KreglingerOfferteTool/` when running `cds-ts watch`).
It returns `KreglingerOfferteTool/node_modules/@sap/cds/lib/index.js` — the **same path**
the CAP server loads — so Node.js's `require` cache returns the same instance. No duplicate.

The `cap-handler-framework/node_modules/@sap/cds` exists only for TypeScript compilation
(`tsc`) and is **never loaded at runtime**.

---

## Module layout after setup

| Path | Purpose | Used at runtime? |
|---|---|---|
| `KreglingerOfferteTool/node_modules/@sap/cds` | THE runtime instance | ✅ Both CAP server and framework |
| `cap-handler-framework/node_modules/@sap/cds` | TypeScript compilation only | ❌ Bypassed by `require.resolve({paths:[cwd]})` |
| `kreglinger/node_modules/@sap/cds` | Should not exist | ❌ |
| `KreglingerOfferteTool/node_modules/cap-handler-framework` | Symlink → `../../cap-handler-framework` | ✅ Live dev link |

---

## One-time setup

```bash
# 1. Install the framework's own dev tools (TypeScript, @sap/cds types)
cd cap-handler-framework
npm install

# 2. Build the framework
npm run build

# 3. Install the CAP project (includes creating the file: symlink)
cd ../KreglingerOfferteTool
npm install
```

> The `.npmrc` in `KreglingerOfferteTool` contains `legacy-peer-deps=true`.  
> This prevents npm from auto-installing peer deps inside the framework's directory
> when running `npm install` from `KreglingerOfferteTool`. Only `devDependencies`
> installed by running `npm install` directly inside `cap-handler-framework/` will exist there.

---

## Development workflow

You need two terminals:

### Terminal 1 — Framework TypeScript watcher

```bash
cd cap-handler-framework
npm run watch
# tsc --watch recompiles to dist/ on every save
```

### Terminal 2 — CAP development server

```bash
cd KreglingerOfferteTool
npm run cds:ts:watch
# or: cds-ts watch
```

When the framework recompiles (`dist/` changes), `cds watch` detects the change in the
symlinked directory and restarts the server automatically.

---

## Single-command development (from repo root)

```bash
npm run dev
# Runs: npm run watch:framework & (cd KreglingerOfferteTool && npm run cds:ts:watch)
```

---

## Verifying the setup

```bash
# 1. Only ONE @sap/cds at runtime (KreglingerOfferteTool):
find . -path "*/node_modules/@sap/cds/package.json" -not -path "*/gen/*" -not -path "*/cds-dk/*"
# Expected: two results:
#   ./KreglingerOfferteTool/node_modules/@sap/cds/package.json  ← runtime
#   ./cap-handler-framework/node_modules/@sap/cds/package.json  ← tsc only
# NOT expected: ./node_modules/@sap/cds/package.json  ← would cause conflict

# 2. Symlink exists:
ls -la KreglingerOfferteTool/node_modules/cap-handler-framework
# → lrwxr-xr-x ... -> ../../cap-handler-framework

# 3. Runtime @sap/cds has all CAP dependencies nearby:
ls KreglingerOfferteTool/node_modules/@sap-cloud-sdk/resilience
```

---

## How changes propagate

```
Edit src/core/HandlerRegistry.ts
  → tsc --watch recompiles → dist/core/HandlerRegistry.js
  → cds-ts watch detects change in cap-handler-framework/dist/
  → Server reloads
  → New logic is active ✅
```

---

## After adding framework as dependency in KreglingerOfferteTool

`KreglingerOfferteTool/package.json` declares:

```json
"cap-handler-framework": "file:../cap-handler-framework"
```

npm 7+ creates a symlink (not a copy) for `file:` dependencies:

```
KreglingerOfferteTool/node_modules/cap-handler-framework → ../../cap-handler-framework
```

This means any change you compile to `dist/` is immediately visible to the CAP project.

---

## BTP / CI/CD deployment

For production deployment, change the dependency to the published npm version:

```json
"cap-handler-framework": "^1.1.0"
```

And publish the framework first:

```bash
cd cap-handler-framework
npm publish
```

The `require.resolve('@sap/cds', { paths: [process.cwd()] })` pattern works in production too:
when running on BTP, `process.cwd()` is the project root where `@sap/cds` is installed normally.

---

## Useful commands

| Command | Description |
|---------|-------------|
| `npm install` (cap-handler-framework) | Install dev tools for TypeScript compilation |
| `npm run build` (cap-handler-framework) | One-time TypeScript build |
| `npm run watch` (cap-handler-framework) | Continuous TypeScript compilation |
| `npm install` (KreglingerOfferteTool) | Install all runtime deps + create symlink |
| `npm run cds:ts:watch` (KreglingerOfferteTool) | Start CAP dev server |
| `npm run dev` (root) | Run both watcher and server in parallel |

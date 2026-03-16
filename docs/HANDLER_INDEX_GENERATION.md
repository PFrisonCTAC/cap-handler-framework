# Handler Index Generation

The framework includes a CDS plugin (`cds-plugin.js`) that automatically generates `index.ts` files for each service's handler directory.

---

## What is generated

For each `srv/<service>/handlers/` directory that contains handler files, the plugin generates:

```typescript
// srv/opportunity-management/handlers/index.ts  (AUTO-GENERATED)

// Entity Handlers
import OpportunitiesHandler from './entities/OpportunitiesHandler';
import TradeSlipsHandler from './entities/TradeSlipsHandler';

// Proxy Handlers
import BusinessPartnersProxyHandler from './proxies/BusinessPartnersProxyHandler';

export const HANDLER_CLASSES = [
  // Entity handlers (2)
  OpportunitiesHandler,
  TradeSlipsHandler,

  // Proxy handlers (1)
  BusinessPartnersProxyHandler,
];
```

This list is then imported by the service file and passed to `registerHandlers()`.

---

## Directory structure expected

```
srv/
└── <service-name>/
    └── handlers/
        ├── index.ts          ← AUTO-GENERATED
        ├── entities/
        │   ├── FooHandler.ts
        │   └── BarHandler.ts
        └── proxies/
            └── BazProxyHandler.ts
```

Rules:
- Files must be inside `entities/` or `proxies/` subdirectories.
- Files must end with `Handler.ts` or `Handler.js`.
- The base filename (without extension) becomes the import name.

---

## CDS lifecycle event: `served`

The plugin hooks into `cds.on('served', ...)`, which fires:
- On every `cds watch` start
- On every `cds watch` hot-reload

This ensures that index files are always regenerated when the server restarts — for example, after adding a new handler file.

---

## Safe write (prevents infinite reload loops)

Without protection, the plugin would rewrite `index.ts` on every `served` event (even when nothing changed), causing `cds watch` to detect a file change and reload indefinitely.

**The plugin only writes the file if the normalised content has changed.**

Normalisation strips any volatile lines (e.g., timestamps) before comparing. As a result:

```
Server starts
  → served fires
  → index.ts written (new handler added)
  → cds watch detects change → reloads

Server restarts
  → served fires
  → index.ts content is IDENTICAL → NOT written
  → cds watch does NOT detect a change → stable ✅
```

The cycle produces exactly **one extra reload** when a handler is added or removed, then stabilises.

---

## File watcher (detects changes between reloads)

The plugin also sets up a filesystem watcher on `srv/` so that `index.ts` is regenerated even when `cds watch` does not reload by itself.

**Priority:**
1. **chokidar** (preferred) — available as a transitive dependency of `@sap/cds-dk`
2. **`fs.watch`** (built-in fallback) — less reliable on some platforms

Watched pattern: `srv/*/handlers/**/*Handler.{ts,js}`

Events handled:
- `add` — a new handler file was created
- `unlink` — a handler file was deleted

A 200 ms debounce prevents multiple simultaneous changes from triggering multiple regenerations.

---

## Reload loop prevention summary

| Scenario | What happens |
|----------|-------------|
| First start (no index.ts) | Written immediately → reload → stable |
| Start with existing index.ts (no change) | Content matches → NOT written → stable (no reload) |
| Handler file added | Written (new content) → reload → same content → NOT written → stable |
| Handler file deleted | Written (new content) → reload → same content → NOT written → stable |
| Framework restarts without handler changes | Content matches → NOT written → stable |

---

## Watcher lifetime

The watcher guard (`watcherInitialized` flag) is stored at **module level** in `cds-plugin.js`. This means:

- The watcher is set up **once per Node.js process** lifecycle.
- Subsequent `served` events (from hot-reloads) skip watcher setup.
- The watcher does NOT persist across process restarts (expected behaviour — `cds watch` itself also restarts).

---

## Troubleshooting

### index.ts is not being generated

1. Check that the handler files are inside `entities/` or `proxies/` subdirectories.
2. Check that filenames end with `Handler.ts` (case-sensitive).
3. Check the CDS log output for `cap-handler-framework` entries.

Enable debug logging in `.cdsrc.json`:

```json
{
  "log": {
    "levels": {
      "cap-handler-framework": "debug"
    }
  }
}
```

### Infinite reload loop

This should not happen with the current version (safe write is always applied). If it does:

1. Check whether another tool (e.g., a formatter) is writing `index.ts` on every save.
2. Check the normalise function handles your file content correctly.

### chokidar not found

If chokidar is not available, the plugin falls back to `fs.watch`. If neither works, check the log for watcher errors. The plugin will still generate on `served` events — you'll just need to restart the server manually after adding a handler.

---

## See also

- [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md)
- [HOOKS.md](./HOOKS.md)

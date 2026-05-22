# Getting Started with cap-handler-framework

This guide walks you through setting up `cap-handler-framework` in a new or existing
SAP CAP TypeScript project from scratch.

---

## Prerequisites

- SAP CAP project with TypeScript (`@sap/cds`, `@sap/cds-dk`)
- Node.js 18+
- TypeScript 5+

---

## 1. Install the framework

```bash
npm install cap-handler-framework
```

For local development (npm link):

```bash
# In the framework repo
cd cap-handler-framework
npm run build
npm link

# In your CAP project
npm link cap-handler-framework
```

---

## 2. Folder structure

Create the following folder structure inside your `srv/` directory:

```
srv/
├── my-service.cds                     ← CDS service definition
├── my-service.ts                      ← CAP service implementation (uses registerHandlers)
└── my-service/
    └── handlers/
        ├── index.ts                   ← HANDLER_CLASSES export (the master list)
        ├── entities/                  ← Entity handlers (CRUD, draft, bound actions)
        │   ├── MyEntityHandler.ts
        │   └── ...
        ├── operations/                ← Unbound action/function handlers
        │   ├── MyActionHandler.ts
        │   └── ...
        ├── proxies/                   ← External OData proxy handlers
        │   ├── MyProxyHandler.ts
        │   └── ...
        └── utils/                     ← Shared utilities (not handlers)
            └── SequenceManager.ts
```

---

## 3. CDS service definition

```cds
// srv/my-service.cds
service MyService {
  // Local entity
  entity Products as projection on db.Product
    actions {
      action Publish() returns Products;        // ← bound action
    };

  // Read-only external proxy
  @readonly
  entity Vendors as projection on external.Vendors;

  // Unbound action (service-level)
  action ImportFromCSV(file: String) returns Integer;
}
```

---

## 4. Entity handler

Entity handlers handle CRUD lifecycle events and bound actions for a specific CDS entity.

```typescript
// handlers/entities/ProductsHandler.ts
import { BaseHandler, TypedRequest } from 'cap-handler-framework';

export default class ProductsHandler extends BaseHandler {
  // ── Required ────────────────────────────────────────────────────────────────
  getEntityName(): string {
    return 'Products';  // must match the entity name in the CDS service exactly
  }

  // ── Optional: enable draft support ──────────────────────────────────────────
  shouldHandleDrafts(): boolean {
    return true;  // set to true if entity has @odata.draft.enabled
  }

  // ── Optional: initialization ─────────────────────────────────────────────────
  async onInit(): Promise<void> {
    // Called after registration — use for DI, pre-fetching config, etc.
  }

  // ── CRUD lifecycle hooks ─────────────────────────────────────────────────────
  async beforeCreate(req: TypedRequest): Promise<void> {
    req.data.createdBy = req.user?.id;
  }

  async afterRead(data: any, req: TypedRequest): Promise<void> {
    // enrich, compute virtual fields, etc.
  }

  // ── Draft lifecycle hooks ────────────────────────────────────────────────────
  async beforeCreateDraft(req: TypedRequest): Promise<void> {
    // fires on entity.drafts CREATE (triggered by NEW)
  }

  async afterPatchDraft(data: any, req: TypedRequest): Promise<void> {
    // fires after each PATCH on a draft
  }

  // ── Bound action ─────────────────────────────────────────────────────────────
  async onBoundAction_Publish(req: TypedRequest): Promise<any> {
    const keyData = req.params[0];
    // ... implementation
    return { success: true };
  }
}
```

### All lifecycle method naming conventions

| Method name | CAP hook | Draft target |
|---|---|---|
| `beforeCreate` | `srv.before('CREATE', entity, ...)` | active entity |
| `afterCreate` | `srv.after('CREATE', entity, ...)` | active entity |
| `onRead` | `srv.on('READ', entity, ...)` | active entity |
| `afterRead` | `srv.after('READ', [entity, entity.drafts], ...)` | both (if draft) |
| `beforeUpdate` | `srv.before('UPDATE', entity, ...)` | active entity |
| `afterUpdate` | `srv.after('UPDATE', entity, ...)` | active entity |
| `beforeDelete` | `srv.before('DELETE', entity, ...)` | active entity |
| `afterDelete` | `srv.after('DELETE', entity, ...)` | active entity |
| `beforeCreateDraft` | `srv.before('CREATE', entity.drafts, ...)` | drafts |
| `afterCreateDraft` | `srv.after('CREATE', entity.drafts, ...)` | drafts |
| `beforePatchDraft` | `srv.before('PATCH', entity.drafts, ...)` | drafts |
| `afterPatchDraft` | `srv.after('PATCH', entity.drafts, ...)` | drafts |
| `beforeNewDraft` | `srv.before('NEW', entity, ...)` | active entity |
| `afterNewDraft` | `srv.after('NEW', entity, ...)` | active entity |
| `beforeEditDraft` | `srv.before('EDIT', entity, ...)` | active entity |
| `afterEditDraft` | `srv.after('EDIT', entity, ...)` | active entity |
| `beforeSaveDraft` | `srv.before('SAVE', entity.drafts, ...)` | drafts |
| `afterSaveDraft` | `srv.after('SAVE', entity.drafts, ...)` | drafts |
| `beforeDiscardDraft` | `srv.before('CANCEL', entity.drafts, ...)` | drafts |
| `afterDiscardDraft` | `srv.after('CANCEL', entity.drafts, ...)` | drafts |
| `onBoundAction_<Name>` | `srv.on('<Name>', entity, ...)` | entity (+ drafts if enabled) |
| `onBoundFunction_<Name>` | `srv.on('<Name>', entity, ...)` | entity (+ drafts if enabled) |

> **Active-only suffix**: append `Active` to force registration on the active entity only:
> `afterReadActive`, `beforeUpdateActive`
>
> **Draft-only suffix**: append `Draft` to force registration on `entity.drafts` only:
> `beforeCreateDraft`, `afterPatchDraft`

---

## 5. Operation handler (unbound action/function)

For actions/functions declared **at service level** (not inside an entity's `actions {}`):

```typescript
// handlers/operations/ImportFromCSVHandler.ts
import { OperationHandler, TypedRequest } from 'cap-handler-framework';

export default class ImportFromCSVHandler extends OperationHandler {
  async onUnboundAction_ImportFromCSV(req: TypedRequest): Promise<any> {
    const { file } = req.data;
    // ... implementation
    return { imported: 42 };
  }
}
```

> `OperationHandler` automatically returns `null` from `getEntityName()` — no CDS entity
> is needed. The registry keys the handler by its **class name**.

---

## 6. Proxy handler (external OData)

Proxy handlers forward reads to external OData services:

```typescript
// handlers/proxies/VendorsProxyHandler.ts
import { ProxyHandler } from 'cap-handler-framework';

export default class VendorsProxyHandler extends ProxyHandler {
  getEntityName()   { return 'Vendors'; }
  getRemoteService() { return 'EXTERNAL_VENDOR_SRV'; }
  getRemoteEntity()  { return 'A_Vendor'; }

  // Optionally exclude CAP-only fields from remote query
  getForbiddenColumns() { return ['myLocalField']; }
}
```

---

## 7. HANDLER_CLASSES index

Maintain a central list of all handler classes:

```typescript
// handlers/index.ts

// Entity handlers
import ProductsHandler from './entities/ProductsHandler';

// Operation handlers
import ImportFromCSVHandler from './operations/ImportFromCSVHandler';

// Proxy handlers
import VendorsProxyHandler from './proxies/VendorsProxyHandler';

export const HANDLER_CLASSES = [
  // Entity handlers first
  ProductsHandler,

  // Operation handlers second
  ImportFromCSVHandler,

  // Proxy handlers last
  VendorsProxyHandler,
];
```

---

## 8. Service implementation

Wire everything together in your CAP service class:

```typescript
// srv/my-service.ts
import { ApplicationService } from '@sap/cds';
import { registerHandlers } from 'cap-handler-framework';
import { HANDLER_CLASSES } from './my-service/handlers';

export class MyService extends ApplicationService {
  async init() {
    await registerHandlers(this, {
      handlerClasses: HANDLER_CLASSES,

      // External OData services used by proxy handlers
      externalServices: [
        'EXTERNAL_VENDOR_SRV',
      ],

      // Shared utilities injected into all handlers
      utilities: {
        // sequenceManager: new SequenceManager(),
      },

      // Optional framework config
      config: {
        enableDraftSupport: true,
        chunkSize: 80,
        enablePerformanceLogging: false,
      },
    });

    return super.init();
  }
}
```

---

## 9. Accessing shared dependencies in handlers

All handlers receive the `HandlerContext` at construction time and can access:

```typescript
// In any handler method:
this.srv           // the CAP ApplicationService
this.db            // the database connection (cds.connect.to('db'))
this.logger        // the scoped CDS logger
this.entity        // the CDS entity definition (entity handlers only)
this.context       // the full HandlerContext

// Helper methods:
this.tx(req)                          // get a transaction for this request
this.getExternalService('VENDOR_SRV') // get a connected external service
this.getUtility<SequenceManager>('sequenceManager')  // get a shared utility
this.toArray(data)                    // normalize single/array to array
this.formatResponse(rows, req)        // return single or array based on request
this.initializeExpandTree(req)        // parse $expand from request
this.isExpanded('association')        // check if an association is requested
```

---

## 10. TypeScript types

The framework exports all types you need:

```typescript
import type {
  TypedRequest,     // extends cds.Request with typed data/params
  ExpandConfig,     // configuration for enrichExpands()
  HandlerContext,   // the full DI context
  Logger,           // cds.log return type
  CAPEvent,         // 'CREATE' | 'READ' | 'UPDATE' | ...
  EventPhase,       // 'before' | 'on' | 'after'
} from 'cap-handler-framework';
```

---

## Common mistakes

| Mistake | Correct approach |
|---|---|
| Extending `BaseHandler` for a service-level action | Extend `OperationHandler` |
| Using `onBoundAction_*` for a service-level action | Use `onUnboundAction_*` |
| Forgetting to add handler to `HANDLER_CLASSES` | Always update `handlers/index.ts` |
| `getEntityName()` returns wrong casing | Must match the CDS service entity name exactly (case-sensitive) |
| Draft hooks not firing | Set `shouldHandleDrafts()` to `true` and ensure `@odata.draft.enabled` on entity |

---

## Next steps

- [SERVICE_LAYER.md](./SERVICE_LAYER.md) — `BaseService`, `getInstance()`, Pattern C error handling, and testing service classes
- [ACTIONS_AND_FUNCTIONS.md](./ACTIONS_AND_FUNCTIONS.md) — detailed guide on actions/functions
- [DRAFTS.md](./DRAFTS.md) — draft lifecycle hooks in detail
- [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) — deep dive into framework internals
- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) — one-page cheat sheet

# cap-handler-framework

Handler framework for SAP CAP applications — convention-based, TypeScript-first, draft-aware.

---

## ✨ Features

- ✅ **Convention-based** — auto-maps methods like `beforeCreate`, `onRead`, `afterUpdate`
- ✅ **Correct draft lifecycle** — explicit hooks for NEW/PATCH/EDIT/SAVE/DISCARD, separated from active entity hooks
- ✅ **Actions & functions** — bound and unbound operations with clear naming (`onBoundAction_`, `onUnboundAction_`, …)
- ✅ **Multi-service** — support for multiple CAP services in one project
- ✅ **Type-safe** — full TypeScript support
- ✅ **Performance** — `ExpandTree` optimization (50–80% fewer remote calls)
- ✅ **Auto-generation** — CDS plugin generates `handlers/index.ts` automatically
- ✅ **Watch support** — `cds watch` triggers index regeneration without infinite reload loops
- ✅ **Dependency injection** — shared context for external services and utilities
- ✅ **Local dev** — npm workspace setup for framework development without publishing

---

## 📦 Installation

```bash
npm install cap-handler-framework
```

---

## 🚀 Quick start

### 1. Create a handler

```typescript
// srv/my-service/handlers/entities/BooksHandler.ts
import { BaseHandler } from 'cap-handler-framework';
import type { TypedRequest } from 'cap-handler-framework';

export default class BooksHandler extends BaseHandler {
  getEntityName() { return 'Books'; }

  async beforeCreate(req: TypedRequest): Promise<void> {
    req.data.createdAt = new Date().toISOString();
  }

  async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
    this.initializeExpandTree(req);
    const result = await next();
    if (this.isExpanded('author')) {
      await this.enrichAuthor(result);
    }
    return result;
  }
}
```

### 2. Register handlers in your service

```typescript
// srv/my-service.ts
import { ApplicationService } from '@sap/cds';
import { registerHandlers } from 'cap-handler-framework';
import { HANDLER_CLASSES } from './my-service/handlers';

export class MyService extends ApplicationService {
  async init() {
    await registerHandlers(this, { handlerClasses: HANDLER_CLASSES });
    return super.init();
  }
}
```

### 3. Start the server

```bash
cds watch
```

The `HANDLER_CLASSES` import is auto-generated. ✅

---

## 🎯 Active entity hooks

| Method | Phase | CAP event | Registers on |
|--------|-------|-----------|--------------|
| `beforeCreate` | before | CREATE | entity |
| `afterCreate` | after | CREATE | entity |
| `beforeRead` | before | READ | entity |
| `onRead` | on | READ | entity |
| `afterRead` | after | READ | entity *(+ entity.drafts if draft-enabled)* |
| `beforeUpdate` | before | UPDATE | entity |
| `afterUpdate` | after | UPDATE | entity |
| `beforeDelete` | before | DELETE | entity |
| `afterDelete` | after | DELETE | entity |

> `beforeCreate` also fires when a draft is activated (SAVE → INSERT on active entity). This is correct CAP behaviour.

---

## 🗂️ Draft lifecycle hooks

Enable draft support in your handler:

```typescript
shouldHandleDrafts(): boolean { return true; }
```

| Method | Phase | CAP event | Registers on |
|--------|-------|-----------|--------------|
| `beforeNewDraft` | before | NEW | entity *(active)* |
| `afterNewDraft` | after | NEW | entity |
| `beforeCreateDraft` | before | CREATE | entity.drafts |
| `afterCreateDraft` | after | CREATE | entity.drafts |
| `beforePatchDraft` | before | PATCH | entity.drafts |
| `afterPatchDraft` | after | PATCH | entity.drafts |
| `beforeEditDraft` | before | EDIT | entity *(active)* |
| `afterEditDraft` | after | EDIT | entity |
| `beforeSaveDraft` | before | SAVE | entity.drafts |
| `afterSaveDraft` | after | SAVE | entity.drafts |
| `beforeDiscardDraft` | before | CANCEL | entity.drafts |
| `afterDiscardDraft` | after | CANCEL | entity.drafts |

> `beforeEditDraft` and `beforeNewDraft` fire on the active entity — CAP fires NEW and EDIT on the active entity, not on the drafts table.

```typescript
export default class TradeSlipsHandler extends BaseHandler {
  getEntityName() { return 'TradeSlips'; }
  shouldHandleDrafts() { return true; }

  // Fires during draft activation (SAVE → CREATE on active entity)
  async beforeCreate(req: TypedRequest): Promise<void> {
    req.data.tradeSlipIndex = await this.sequenceManager.nextIndex();
  }

  // User changed a field in the draft form
  async afterPatchDraft(data: any, req: TypedRequest): Promise<void> {
    await this.autoFillDeliveryAddress(this.toArray(data)[0], req);
  }

  // Final validation before activation
  async beforeSaveDraft(req: TypedRequest): Promise<void> {
    if (!req.data.customerNumber) req.error(400, 'Customer is required');
  }

  // User clicked "Discard"
  async beforeDiscardDraft(req: TypedRequest): Promise<void> {
    this.logger.info('Draft discarded');
  }
}
```

---

## ⚡ Actions and functions

### Naming convention

| Method prefix | Registers as |
|--------------|-------------|
| `onBoundAction_<Name>` | `srv.on('<Name>', entity, handler)` |
| `onUnboundAction_<Name>` | `srv.on('<Name>', handler)` |
| `onBoundFunction_<Name>` | `srv.on('<Name>', entity, handler)` |
| `onUnboundFunction_<Name>` | `srv.on('<Name>', handler)` |
| `on<Name>` *(legacy)* | auto-detected from CDS model |

### Bound action example

```cds
// CDS definition
entity TradeSlips ... actions {
  action DuplicateTradeSlip() returns TradeSlips;
};
```

```typescript
// Handler
async onBoundAction_DuplicateTradeSlip(req: TypedRequest): Promise<any> {
  const { ID } = req.params[0] as any; // entity key
  const tx = this.tx(req);
  // ... duplicate logic ...
  return copy;
}
```

```http
POST /odata/v4/opportunity-management/TradeSlips(ID=550e8400...)/DuplicateTradeSlip
```

### Unbound action example

```cds
// CDS definition
service OpportunityManagementService {
  action CreateWithReference(quote_ID: UUID) returns String;
}
```

```typescript
// Handler
async onUnboundAction_CreateWithReference(req: TypedRequest): Promise<any> {
  const { quote_ID } = req.data;
  // ... create from reference ...
  return `Created from quote ${quote_ID}`;
}
```

```http
POST /odata/v4/opportunity-management/CreateWithReference
{ "quote_ID": "..." }
```

---

## 🔌 External services

```typescript
await registerHandlers(this, {
  handlerClasses: HANDLER_CLASSES,
  externalServices: ['API_BUSINESS_PARTNER', 'API_PRODUCT_SRV'],
  utilities: { sequenceManager: new SequenceManager() },
});
```

In the handler:

```typescript
const bpApi = this.getExternalService('API_BUSINESS_PARTNER');
const result = await bpApi.run(SELECT.from('A_BusinessPartner').where({ ... }));
```

---

## 🏗️ Project structure

```
srv/
└── opportunity-management/
    ├── handlers/
    │   ├── index.ts             ← AUTO-GENERATED by cds-plugin
    │   ├── entities/
    │   │   ├── TradeSlipsHandler.ts
    │   │   └── TradeSlipItemHandler.ts
    │   └── proxies/
    │       └── BusinessPartnersProxyHandler.ts
    └── utils/
        └── SequenceManager.ts
```

---

## 📖 Documentation

| Document | Topic |
|----------|-------|
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | Full setup walkthrough — handlers, operations, proxies |
| [docs/HOOKS.md](docs/HOOKS.md) | Active entity lifecycle hooks |
| [docs/DRAFTS.md](docs/DRAFTS.md) | Draft lifecycle — NEW, PATCH, EDIT, SAVE, DISCARD |
| [docs/ACTIONS_AND_FUNCTIONS.md](docs/ACTIONS_AND_FUNCTIONS.md) | Bound/unbound actions and functions |
| [docs/SERVICE_LAYER.md](docs/SERVICE_LAYER.md) | Service layer pattern — `BaseService`, Pattern C, testing |
| [docs/HANDLER_INDEX_GENERATION.md](docs/HANDLER_INDEX_GENERATION.md) | CDS plugin, safe write, file watcher |
| [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) | Local dev with file: symlink and switching to npm |
| [docs/QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md) | One-page cheat sheet |

---

## 🛠️ Local development

Use a `file:` dependency to develop the framework alongside a CAP project without publishing:

```json
// my-cap-project/package.json
"cap-handler-framework": "file:../cap-handler-framework"
```

```bash
cd cap-handler-framework && npm run watch   # recompile on save
cd my-cap-project && cds-ts watch           # CAP dev server picks up changes via symlink
```

When you're ready to switch back to the published npm version:

```bash
# Remove the symlink first (npm install alone won't replace it)
rm my-cap-project/node_modules/cap-handler-framework
cd my-cap-project && npm install cap-handler-framework@latest
```

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for the full setup and troubleshooting guide.

---

## 📝 License

MIT

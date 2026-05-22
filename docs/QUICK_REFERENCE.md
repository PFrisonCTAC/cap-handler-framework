# ⚡ Quick Reference - CAP Handler Framework

One-page cheat sheet voor het CAP Handler Framework.

---

## 🎯 Handler Template

```typescript
import { BaseHandler, TypedRequest } from 'cap-handler-framework';

export default class MyEntityHandler extends BaseHandler {
  getEntityName() { return 'MyEntity'; }
  shouldHandleDrafts() { return false; }

  async beforeCreate(req: TypedRequest): Promise<void> { }
  async afterCreate(data: any, req: TypedRequest): Promise<void> { }
  
  async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
    return await next();
  }
  
  async beforeUpdate(req: TypedRequest): Promise<void> { }
  async afterUpdate(data: any, req: TypedRequest): Promise<void> { }
  
  async beforeDelete(req: TypedRequest): Promise<void> { }
  async afterDelete(data: any, req: TypedRequest): Promise<void> { }
}
```

---

## 📋 Convention-Based Method Names

| CDS Event | Method Name | Description |
|-----------|-------------|-------------|
| **CREATE** |
| `before('CREATE')` | `beforeCreate(req)` | Validate, set defaults |
| `on('CREATE')` | `onCreate(req, next)` | Custom create logic |
| `after('CREATE')` | `afterCreate(data, req)` | Post-create tasks |
| **READ** |
| `before('READ')` | `beforeRead(req)` | Modify query |
| `on('READ')` | `onRead(req, next)` | Custom read logic |
| `after('READ')` | `afterRead(data, req)` | Enrich per row |
| **UPDATE** |
| `before('UPDATE')` | `beforeUpdate(req)` | Validate changes |
| `on('UPDATE')` | `onUpdate(req, next)` | Custom update |
| `after('UPDATE')` | `afterUpdate(data, req)` | Post-update |
| **PATCH** |
| `before('PATCH')` | `beforePatch(req)` | Validate patch |
| `after('PATCH')` | `afterPatch(data, req)` | Auto-compute |
| **DELETE** |
| `before('DELETE')` | `beforeDelete(req)` | Validate deletion |
| `after('DELETE')` | `afterDelete(data, req)` | Cleanup |

---

## 🎨 Draft-Specific Methods

| Method | When | Entity |
|--------|------|--------|
| `beforeCreateDraft` | User clicks "Create" | `.drafts` only |
| `beforeEditActive` | User clicks "Edit" | Active only |
| `afterPatchDraft` | Field changed in UI | `.drafts` only |
| `beforeSaveDraft` | User clicks "Save" | `.drafts` only |
| `afterSaveDraft` | Draft activated | Active only |
| `beforeCancelDraft` | User clicks "Cancel" | `.drafts` only |
| `beforeDiscardDraft` | User discards | `.drafts` only |

---

## ⚡ Bound Actions / Functions

Declared inside an **entity's** `actions {}` block. Handler lives in the entity's `BaseHandler` subclass.

**CDS:**
```cds
entity Books as projection on db.Books
  actions {
    action Borrow(days: Integer) returns Books;
    function GetSummary() returns Summary;
  };
```

**Handler:**
```typescript
// In your BaseHandler subclass — getEntityName() = 'Books'

// Prefix: onBoundAction_<ActionName>
async onBoundAction_Borrow(req: TypedRequest): Promise<any> {
  const keyData = req.params[0];   // Entity key from URL
  const { days } = req.data;       // Action parameters
  // ...
  return updatedEntity;
}

// Prefix: onBoundFunction_<FunctionName>
async onBoundFunction_GetSummary(req: TypedRequest): Promise<any> {
  // ...
}
```

CAP registration: `srv.on('Borrow', 'Books', handler)`

> If `shouldHandleDrafts()=true`, also registered on `Books.drafts`.

---

## 🌐 Unbound Actions / Functions

Declared **at service level** — NOT inside any entity's `actions {}`. Use `OperationHandler`.

**CDS:**
```cds
service CatalogService {
  action ResetAll()                    returns { count: Integer };
  function Search(query: String)       returns array of Books;
}
```

**Handler (new file in `handlers/operations/`):**
```typescript
import { OperationHandler, TypedRequest } from 'cap-handler-framework';

export default class CatalogOperationsHandler extends OperationHandler {
  // Prefix: onUnboundAction_<ActionName>
  async onUnboundAction_ResetAll(req: TypedRequest): Promise<any> {
    // ...
    return { count: 42 };
  }

  // Prefix: onUnboundFunction_<FunctionName>
  async onUnboundFunction_Search(req: TypedRequest): Promise<any> {
    const { query } = req.data;
    return await SELECT.from('Books').where(`title like '%${query}%'`);
  }
}
```

CAP registration: `srv.on('ResetAll', handler)` (no entity argument)

**⚠️ Must be added to `HANDLER_CLASSES` in `handlers/index.ts`:**
```typescript
import CatalogOperationsHandler from './operations/CatalogOperationsHandler';
export const HANDLER_CLASSES = [ ..., CatalogOperationsHandler ];
```

> **Common mistake:** using `onBoundAction_*` or placing the method in a `BaseHandler`
> for a service-level action. This registers it on an entity and the action will never fire.

---

## 🛠️ Helpers Cheat Sheet

### Request Data

```typescript
req.data           // Input data
req.params[0]      // Entity key (for bound actions)
req.user.id        // Current user
req.query          // CQN query
```

### Database Operations

```typescript
// SELECT
const result = await SELECT.from('Books').where({ ID });
const one = await SELECT.one.from('Books').where({ ID });

// INSERT
await INSERT.into('Books').entries({ ... });

// UPDATE
await UPDATE('Books').set({ status: 'NEW' }).where({ ID });

// DELETE
await DELETE.from('Books').where({ ID });

// Transaction
const tx = this.tx(req);
await tx.run(query);
```

### BaseService Methods (service layer)

```typescript
// Singleton factory — connects on first call, cached thereafter
const svc = await BaseService.getInstance(MyService);
const [a, b] = await BaseService.getInstances([ServiceA, ServiceB]);

// Raw CDS handle — for complex handler-specific queries
const api = svc.getService();
await api.run(SELECT.from(api.entities.A_MyEntity).where(...));

// Test teardown
BaseService.reset(); // clears all cached instances
```

### BaseHandler Methods

```typescript
// External services (legacy / proxy pattern)
this.getExternalService('API_NAME')
this.getUtility('utilityName')

// Performance
this.initializeExpandTree(req)
this.isExpanded('association')
this.stripVirtualElements(query)

// Data transformation
this.toArray(data)
this.formatResponse(rows, req)
this.deepCopy(source, options)

// Logging
this.logger.info('message')
this.logger.warn('message')
this.logger.error('message')
this.logPerformance('operation', async () => { ... })
```

---

## 🗂️ Service Layer (preferred)

Create a typed service class — queries get a name, handlers stay clean:

```typescript
import { BaseService } from 'cap-handler-framework';

export default class AddressesService extends BaseService {
  constructor() { super('API_BUSINESS_PARTNER'); }

  public async getFirstForBP(bpId: string): Promise<any | null> {
    const { A_BusinessPartnerAddress } = this.getService().entities;
    const result = await this.getService().run(
      SELECT.from(A_BusinessPartnerAddress).where({ BusinessPartner: bpId }).limit(1)
    );
    const first = Array.isArray(result) ? result[0] : result;
    return first ?? null;
  }
}
```

**In the handler — always Pattern C (services throw, handlers catch):**

```typescript
let svc: AddressesService;
try {
  svc = await BaseService.getInstance(AddressesService);
} catch (err: any) {
  this.logger.error('Handler: connect failed:', err?.message);
  req.error(503, 'Service unavailable.'); return;
}

let addr: any;
try {
  addr = await svc.getFirstForBP(bpId);
} catch (err: any) {
  this.logger.error(`Handler: lookup failed for ${bpId}:`, err?.message);
  req.error(503, 'Service unavailable.'); return;
}
```

**Multiple services in parallel:**
```typescript
const [addrSvc, bpSvc] = await BaseService.getInstances([AddressesService, BusinessPartnersService]);
```

See [SERVICE_LAYER.md](./SERVICE_LAYER.md) for the full guide.

---

## 🔌 External Services (legacy / proxy handlers)

For proxy handlers or quick one-off access — use `getExternalService()` from within a handler that has it registered via `externalServices` in the `registerHandlers()` config:

```typescript
const bpApi = this.getExternalService('API_BUSINESS_PARTNER');
const result = await bpApi.run(SELECT.from('A_BusinessPartner').where(...));
```

---

## 📁 Folder Structure

```
srv/
└── my-service/
    ├── my-service.cds              ← Service definition
    ├── handlers.config.json        ← Optional config
    └── handlers/
        ├── entities/               ← Entity handlers
        │   ├── BooksHandler.ts
        │   └── AuthorsHandler.ts
        ├── proxies/                ← External service proxies
        │   └── BusinessPartnersProxyHandler.ts
        ├── operations/             ← Unbound actions/functions
        │   ├── searchBooks.ts
        │   └── resetAll.ts
        └── utils/                  ← Service-specific utilities
            └── SequenceManager.ts
```

---

## ⚙️ Configuration File

```json
// srv/my-service/handlers.config.json (optional)
{
  "externalServices": [
    "API_BUSINESS_PARTNER",
    "API_PRODUCT_SRV"
  ],
  "utilities": {
    "sequenceManager": "./handlers/utils/SequenceManager",
    "validator": "./handlers/utils/Validator"
  },
  "config": {
    "chunkSize": 80,
    "enablePerformanceLogging": true,
    "enableDraftSupport": true
  }
}
```

---

## 🚦 Error Handling

```typescript
// Error in request
req.error(400, 'Validation failed');
req.error(404, 'Not found');
req.error(403, 'Forbidden');

// Reject request
return req.reject(400, 'Bad request');

// Throw error (caught by framework)
throw new Error('Something went wrong');
```

---

## 🎯 Common Patterns

### Pattern: Validation

```typescript
async beforeCreate(req: TypedRequest): Promise<void> {
  if (!req.data.title) {
    req.error(400, 'Title is required');
  }
}
```

### Pattern: Default Values

```typescript
async beforeCreate(req: TypedRequest): Promise<void> {
  req.data.status = req.data.status || 'NEW';
  req.data.createdAt = new Date();
}
```

### Pattern: Sequence Generation

```typescript
async beforeCreate(req: TypedRequest): Promise<void> {
  const seq = this.getUtility('sequenceManager');
  req.data.number = await seq.getNext();
}
```

### Pattern: Enrichment

```typescript
async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
  this.initializeExpandTree(req);
  const result = await next();
  
  if (this.isExpanded('association')) {
    await this.enrichAssociation(result);
  }
  
  return result;
}
```

### Pattern: Audit Logging

```typescript
async afterCreate(data: any, req: TypedRequest): Promise<void> {
  await INSERT.into('AuditLog').entries({
    entity: this.getEntityName(),
    action: 'CREATE',
    entityID: data.ID,
    user: req.user.id,
  });
}
```

### Pattern: Dependency Check

```typescript
async beforeDelete(req: TypedRequest): Promise<void> {
  const count = await SELECT.from('ChildEntity')
    .where({ parent_ID: req.data.ID });
  
  if (count.length > 0) {
    req.error(400, 'Cannot delete: has child records');
  }
}
```

---

## 🐛 Debugging

```typescript
// Log request
this.logger.info('Request:', req.data);

// Log query
this.logger.info('Query:', JSON.stringify(req.query, null, 2));

// Performance tracking
await this.logPerformance('OperationName', async () => {
  // Your code
});
```

---

## 📖 Full Documentation

- **[Getting Started](./GETTING_STARTED.md)** — Full setup walkthrough
- **[Developer Guide](./DEVELOPER_GUIDE.md)** — Complete tutorial
- **[Service Layer](./SERVICE_LAYER.md)** — `BaseService`, Pattern C, testing
- **[Drafts](./DRAFTS.md)** — Draft lifecycle hooks
- **[Actions & Functions](./ACTIONS_AND_FUNCTIONS.md)** — Bound/unbound operations

---

**Print this page for quick reference! 📄**

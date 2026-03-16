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

## ⚡ Bound Actions

**CDS:**
```cds
entity Books actions {
  action borrow(days: Integer) returns Books;
}
```

**Handler:**
```typescript
async onBorrow(req: TypedRequest): Promise<any> {
  const { ID } = req.params[0];  // Entity key
  const { days } = req.data;      // Parameters
  
  // Your logic
  
  return updatedEntity;
}
```

---

## 🌐 Unbound Actions

**CDS:**
```cds
service CatalogService {
  action resetAll() returns { count: Integer };
}
```

**Handler:**
```typescript
// srv/catalog-service/handlers/operations/resetAll.ts
export default async function resetAll(req: Request) {
  // Your logic
  return { count: 42 };
}
```

---

## 🔧 Functions

**CDS:**
```cds
function search(query: String) returns array of Books;
```

**Handler:**
```typescript
// srv/catalog-service/handlers/operations/search.ts
export default async function search(req: Request) {
  const { query } = req.data;
  return await SELECT.from('Books').where(`title like '%${query}%'`);
}
```

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

### BaseHandler Methods

```typescript
// Services
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

## 🔌 External Services

**Config:**
```json
// handlers.config.json
{
  "externalServices": ["API_BUSINESS_PARTNER"]
}
```

**Usage:**
```typescript
const bpApi = this.getExternalService('API_BUSINESS_PARTNER');
const result = await bpApi.run(SELECT.from('A_BusinessPartner').where(...));
```

---

## 🏭 HandlerFactory

```typescript
import HandlerFactory from 'cap-handler-framework';

const factory = HandlerFactory.getInstance();
const otherHandler = factory.getTradeSlipsHandler();
await otherHandler.somePublicMethod(data);
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

- **[Developer Guide](./DEVELOPER_GUIDE.md)** - Complete tutorial
- **[Factory Pattern](./FACTORY_PATTERN_USAGE.md)** - Cross-handler communication
- **[NPM Library](./NPM_LIBRARY_PROPOSAL.md)** - Library architecture

---

**Print this page for quick reference! 📄**

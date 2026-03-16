# 📘 CAP Handler Framework - Developer Guide

Complete handleiding voor het gebruik van `cap-handler-framework`.

---

## 📚 Inhoudsopgave

1. [Quick Start](#quick-start)
2. [Entity Handler Maken](#entity-handler-maken)
3. [Service Opstarten](#service-opstarten)
4. [CRUD Handlers](#crud-handlers)
5. [Draft Lifecycle](#draft-lifecycle)
6. [Bound Actions](#bound-actions)
7. [Unbound Actions](#unbound-actions)
8. [Functions](#functions)
9. [External Services](#external-services)
10. [Utilities](#utilities)
11. [Advanced Features](#advanced-features)

---

## 🚀 Quick Start

### 1. Installeer Framework

```bash
npm install cap-handler-framework
```

### 2. Project Structuur

```
my-cap-project/
├── package.json
├── db/
│   └── schema.cds
└── srv/
    └── my-service/
        ├── my-service.cds           ← Service definitie
        └── handlers/                ← Handlers (auto-discovered)
            ├── entities/
            │   └── BooksHandler.ts
            └── operations/
                └── searchBooks.ts
```

### 3. Create Service Definition

```cds
// srv/my-service/my-service.cds
using { my.bookshop as db } from '../../db/schema';

service CatalogService {
  entity Books as projection on db.Books actions {
    action borrow() returns Books;
  };
  
  function searchBooks(query: String) returns array of Books;
}
```

### 4. Create Handler

```typescript
// srv/my-service/handlers/entities/BooksHandler.ts
import { BaseHandler, TypedRequest } from 'cap-handler-framework';

export default class BooksHandler extends BaseHandler {
  getEntityName(): string {
    return 'Books';
  }

  async beforeCreate(req: TypedRequest): Promise<void> {
    req.data.createdAt = new Date();
  }
}
```

### 5. Start Service

```bash
cds watch
```

**That's it!** Handlers zijn automatisch geregistreerd! ✅

---

## 📝 Entity Handler Maken

### Stap 1: Create Handler File

**Naming Convention:** `<EntityName>Handler.ts`

```bash
# Voorbeelden
srv/my-service/handlers/entities/BooksHandler.ts
srv/my-service/handlers/entities/AuthorsHandler.ts
srv/my-service/handlers/entities/OrdersHandler.ts
```

### Stap 2: Extend BaseHandler

```typescript
import { BaseHandler, TypedRequest } from 'cap-handler-framework';

export default class BooksHandler extends BaseHandler {
  // REQUIRED: Entity naam
  getEntityName(): string {
    return 'Books';
  }

  // OPTIONAL: Draft support
  shouldHandleDrafts(): boolean {
    return false; // true voor draft-enabled entities
  }

  // OPTIONAL: Initialization
  async onInit(): Promise<void> {
    this.logger.info('BooksHandler initialized');
  }

  // OPTIONAL: Cleanup
  async onDestroy(): Promise<void> {
    this.logger.info('BooksHandler destroyed');
  }
}
```

### Stap 3: Add Event Handlers

**Convention-based method names automatisch gemapped:**

```typescript
export default class BooksHandler extends BaseHandler {
  getEntityName() { return 'Books'; }

  // Before CREATE
  async beforeCreate(req: TypedRequest): Promise<void> {
    req.data.status = 'NEW';
  }

  // Before UPDATE
  async beforeUpdate(req: TypedRequest): Promise<void> {
    req.data.modifiedAt = new Date();
  }

  // Before DELETE
  async beforeDelete(req: TypedRequest): Promise<void> {
    // Validatie
    if (req.data.status === 'ACTIVE') {
      req.error(400, 'Cannot delete active book');
    }
  }

  // On READ
  async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
    const result = await next();
    // Enrich result
    return result;
  }

  // After READ (per row)
  async afterRead(data: any, req: TypedRequest): Promise<void> {
    data.enrichedField = 'value';
  }

  // After CREATE
  async afterCreate(data: any, req: TypedRequest): Promise<void> {
    this.logger.info(`Book created: ${data.ID}`);
  }
}
```

---

## 🎬 Service Opstarten

### Optie 1: Zero-Config (Aanbevolen)

**Geen configuratie nodig!** Framework detecteert handlers automatisch.

```bash
cds watch
```

**Output:**
```
[cap-handler-framework] Initializing...
[cap-handler-framework] Registering handlers for CatalogService
Loaded handler for Books
Loaded handler for Authors
Registered 2 handler(s)
```

### Optie 2: Met Configuration

**Voor complexe scenarios:**

```json
// srv/my-service/handlers.config.json
{
  "externalServices": ["API_BUSINESS_PARTNER"],
  "utilities": {
    "sequenceManager": "./handlers/utils/SequenceManager"
  },
  "config": {
    "chunkSize": 100,
    "enablePerformanceLogging": true,
    "enableDraftSupport": true
  }
}
```

### Optie 3: Programmatic (Advanced)

```typescript
// srv/my-service/my-service-plugin.ts
import { registerHandlers } from 'cap-handler-framework';
import cds from '@sap/cds';
import BooksHandler from './handlers/entities/BooksHandler';

module.exports = cds.plugin('my-service', {
  async init() {
    cds.on('served', async (srv) => {
      if (srv.name === 'CatalogService') {
        await registerHandlers(srv, {
          handlerClasses: [BooksHandler],
          config: { customOption: true },
        });
      }
    });
  }
});
```

---

## 📋 CRUD Handlers

### Complete CRUD Example

```typescript
import { BaseHandler, TypedRequest } from 'cap-handler-framework';

export default class BooksHandler extends BaseHandler {
  getEntityName() { return 'Books'; }

  // ========================================
  // CREATE
  // ========================================

  async beforeCreate(req: TypedRequest): Promise<void> {
    // Validatie
    if (!req.data.title) {
      req.error(400, 'Title is required');
    }

    // Default values
    req.data.status = req.data.status || 'AVAILABLE';
    req.data.createdAt = new Date();

    // Business logic
    const sequenceManager = this.getUtility('sequenceManager');
    if (sequenceManager) {
      req.data.bookNumber = await sequenceManager.getNextNumber();
    }
  }

  async afterCreate(data: any, req: TypedRequest): Promise<void> {
    // Notificatie sturen
    this.logger.info(`Book created: ${data.title} (${data.ID})`);

    // Audit log
    await INSERT.into('AuditLog').entries({
      entity: 'Books',
      action: 'CREATE',
      entityID: data.ID,
      user: req.user.id,
    });
  }

  // ========================================
  // READ
  // ========================================

  async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
    // Initialize expand tree voor performance
    this.initializeExpandTree(req);

    // Execute query
    const result = await next();
    const rows = this.toArray(result);

    // Enrich only if expanded
    if (this.isExpanded('author')) {
      await this.enrichAuthor(rows);
    }

    return this.formatResponse(rows, req);
  }

  async afterRead(data: any, req: TypedRequest): Promise<void> {
    // Per-row enrichment
    data.availability = data.stock > 0 ? 'Available' : 'Out of Stock';
  }

  // ========================================
  // UPDATE
  // ========================================

  async beforeUpdate(req: TypedRequest): Promise<void> {
    // Validatie
    const existing = await SELECT.one.from('Books').where({ ID: req.data.ID });

    if (!existing) {
      req.error(404, 'Book not found');
    }

    if (existing.status === 'ARCHIVED') {
      req.error(400, 'Cannot update archived book');
    }

    // Audit tracking
    req.data.modifiedAt = new Date();
    req.data.modifiedBy = req.user.id;
  }

  async afterUpdate(data: any, req: TypedRequest): Promise<void> {
    // Log change
    this.logger.info(`Book updated: ${data.ID}`);

    // Invalidate cache
    await this.invalidateCache(data.ID);
  }

  // ========================================
  // DELETE
  // ========================================

  async beforeDelete(req: TypedRequest): Promise<void> {
    // Check dependencies
    const borrowCount = await SELECT.from('Borrows')
      .where({ book_ID: req.data.ID, status: 'ACTIVE' });

    if (borrowCount.length > 0) {
      req.error(400, 'Cannot delete book with active borrows');
    }
  }

  async afterDelete(data: any, req: TypedRequest): Promise<void> {
    // Cleanup related data
    await DELETE.from('BookReviews').where({ book_ID: data.ID });

    this.logger.info(`Book deleted: ${data.ID}`);
  }

  // ========================================
  // HELPERS
  // ========================================

  private async enrichAuthor(rows: any[]): Promise<void> {
    const authorIds = [...new Set(rows.map(r => r.author_ID).filter(Boolean))];

    if (authorIds.length === 0) return;

    const authors = await SELECT.from('Authors').where({ ID: { in: authorIds } });
    const authorMap = new Map(authors.map(a => [a.ID, a]));

    rows.forEach(row => {
      row.author = authorMap.get(row.author_ID) || null;
    });
  }

  private async invalidateCache(bookID: string): Promise<void> {
    // Your cache invalidation logic
  }
}
```

---

## 🎨 Draft Lifecycle

### Enable Draft Support

```typescript
export default class OrdersHandler extends BaseHandler {
  getEntityName() { return 'Orders'; }

  shouldHandleDrafts(): boolean {
    return true; // Enable draft support
  }
}
```

### Draft-Specific Methods

```typescript
export default class OrdersHandler extends BaseHandler {
  getEntityName() { return 'Orders'; }
  shouldHandleDrafts() { return true; }

  // ========================================
  // DRAFT: NEW
  // ========================================

  async beforeNewDraft(req: TypedRequest): Promise<void> {
    // Called when user clicks "Create" in Fiori
    req.data.status = 'DRAFT';
    req.data.draftCreatedAt = new Date();
  }

  // ========================================
  // DRAFT: EDIT
  // ========================================

  async beforeEditActive(req: TypedRequest): Promise<void> {
    // Called when user clicks "Edit" on active entity
    this.logger.info(`Editing order: ${req.data.ID}`);
  }

  // ========================================
  // DRAFT: PATCH
  // ========================================

  async afterPatchDraft(data: any, req: TypedRequest): Promise<void> {
    // Called after each field change in UI
    // Auto-compute derived fields
    if (data.quantity || data.unitPrice) {
      await UPDATE('Orders.drafts')
        .set({ total: data.quantity * data.unitPrice })
        .where({ ID: data.ID });
    }
  }

  // ========================================
  // DRAFT: SAVE (ACTIVATE)
  // ========================================

  async beforeSaveDraft(req: TypedRequest): Promise<void> {
    // Called when user clicks "Save"
    // Validate before activation
    if (!req.data.customer_ID) {
      req.error(400, 'Customer is required');
    }

    if (!req.data.items || req.data.items.length === 0) {
      req.error(400, 'Order must have at least one item');
    }

    // Calculate totals
    const total = req.data.items.reduce((sum, item) => {
      return sum + (item.quantity * item.unitPrice);
    }, 0);

    req.data.total = total;
    req.data.status = 'CONFIRMED';
  }

  async afterSaveDraft(data: any, req: TypedRequest): Promise<void> {
    // Called after successful activation
    this.logger.info(`Order activated: ${data.orderNumber}`);

    // Send confirmation email
    await this.sendOrderConfirmation(data);
  }

  // ========================================
  // DRAFT: CANCEL
  // ========================================

  async beforeCancelDraft(req: TypedRequest): Promise<void> {
    // Called when user clicks "Cancel"
    this.logger.info(`Draft cancelled: ${req.data.ID}`);
  }

  // ========================================
  // DRAFT: DISCARD
  // ========================================

  async beforeDiscardDraft(req: TypedRequest): Promise<void> {
    // Called when user discards changes
    this.logger.info(`Changes discarded: ${req.data.ID}`);
  }

  // ========================================
  // HELPERS
  // ========================================

  private async sendOrderConfirmation(order: any): Promise<void> {
    // Your email logic
  }
}
```

### Draft + Active Methods

Framework registreert automatisch op **beide** entity en entity.drafts:

```typescript
// This handler runs for BOTH active AND draft
async beforeCreate(req: TypedRequest): Promise<void> {
  // Runs for Orders AND Orders.drafts
  req.data.createdAt = new Date();
}

// This handler ONLY runs for drafts
async beforeCreateDraft(req: TypedRequest): Promise<void> {
  // Runs ONLY for Orders.drafts
  req.data.isDraft = true;
}

// This handler ONLY runs for active
async beforeCreateActive(req: TypedRequest): Promise<void> {
  // Runs ONLY for Orders (not drafts)
  req.data.isActive = true;
}
```

---

## ⚡ Bound Actions

### Define in CDS

```cds
// srv/catalog-service/catalog-service.cds
service CatalogService {
  entity Books as projection on db.Books actions {
    action borrow(days: Integer) returns Books;
    action return() returns Books;
    action reserve(until: Date) returns { success: Boolean; message: String };
  };
}
```

### Implement in Handler

```typescript
import { BaseHandler, TypedRequest } from 'cap-handler-framework';

export default class BooksHandler extends BaseHandler {
  getEntityName() { return 'Books'; }

  // ========================================
  // BOUND ACTION: borrow
  // ========================================

  async onBorrow(req: TypedRequest): Promise<any> {
    const { ID } = req.params[0]; // Entity key
    const { days } = req.data;     // Action parameters

    // Load entity
    const book = await SELECT.one.from('Books').where({ ID });

    if (!book) {
      return req.error(404, 'Book not found');
    }

    if (book.status !== 'AVAILABLE') {
      return req.error(400, 'Book is not available');
    }

    // Business logic
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);

    await UPDATE('Books')
      .set({
        status: 'BORROWED',
        borrowedBy: req.user.id,
        borrowedAt: new Date(),
        dueDate: dueDate,
      })
      .where({ ID });

    // Return updated entity
    return await SELECT.one.from('Books').where({ ID });
  }

  // ========================================
  // BOUND ACTION: return
  // ========================================

  async onReturn(req: TypedRequest): Promise<any> {
    const { ID } = req.params[0];

    const book = await SELECT.one.from('Books').where({ ID });

    if (!book) {
      return req.error(404, 'Book not found');
    }

    if (book.status !== 'BORROWED') {
      return req.error(400, 'Book is not borrowed');
    }

    // Check if overdue
    const now = new Date();
    const isOverdue = new Date(book.dueDate) < now;

    if (isOverdue) {
      const daysOverdue = Math.ceil(
        (now.getTime() - new Date(book.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Calculate fine
      const fine = daysOverdue * 2; // €2 per day

      await INSERT.into('Fines').entries({
        user_ID: book.borrowedBy,
        book_ID: ID,
        amount: fine,
        reason: `${daysOverdue} days overdue`,
      });
    }

    // Update book
    await UPDATE('Books')
      .set({
        status: 'AVAILABLE',
        borrowedBy: null,
        borrowedAt: null,
        dueDate: null,
        returnedAt: now,
      })
      .where({ ID });

    return await SELECT.one.from('Books').where({ ID });
  }

  // ========================================
  // BOUND ACTION: reserve
  // ========================================

  async onReserve(req: TypedRequest): Promise<any> {
    const { ID } = req.params[0];
    const { until } = req.data;

    const book = await SELECT.one.from('Books').where({ ID });

    if (!book) {
      return req.error(404, 'Book not found');
    }

    // Check if already reserved
    const existingReservation = await SELECT.one
      .from('Reservations')
      .where({ book_ID: ID, status: 'ACTIVE' });

    if (existingReservation) {
      return {
        success: false,
        message: 'Book is already reserved',
      };
    }

    // Create reservation
    await INSERT.into('Reservations').entries({
      book_ID: ID,
      user_ID: req.user.id,
      reservedAt: new Date(),
      until: until,
      status: 'ACTIVE',
    });

    await UPDATE('Books').set({ status: 'RESERVED' }).where({ ID });

    return {
      success: true,
      message: `Book reserved until ${until}`,
    };
  }
}
```

### Method Naming Convention

| Action Name | Handler Method |
|-------------|----------------|
| `borrow` | `onBorrow` |
| `return` | `onReturn` |
| `calculateTotal` | `onCalculateTotal` |
| `sendNotification` | `onSendNotification` |

**Convention:** `on<ActionName>` (camelCase)

---

## 🌐 Unbound Actions

### Define in CDS

```cds
// srv/catalog-service/catalog-service.cds
service CatalogService {
  // Unbound actions (no entity)
  action resetAllStatuses() returns { count: Integer };
  action sendWeeklyReport() returns { success: Boolean };
}
```

### Implement in Operations File

**Location:** `srv/<service>/handlers/operations/<actionName>.ts`

```typescript
// srv/catalog-service/handlers/operations/resetAllStatuses.ts
import type { Request } from '@sap/cds';

export default async function resetAllStatuses(req: Request) {
  // Reset all book statuses to AVAILABLE
  const result = await UPDATE('Books')
    .set({ status: 'AVAILABLE' })
    .where({ status: { in: ['BORROWED', 'RESERVED'] } });

  const count = result; // Number of affected rows

  return { count };
}
```

```typescript
// srv/catalog-service/handlers/operations/sendWeeklyReport.ts
import type { Request } from '@sap/cds';

export default async function sendWeeklyReport(req: Request) {
  try {
    // Fetch statistics
    const stats = await SELECT.from('Books')
      .columns('status', 'count(*) as count')
      .groupBy('status');

    // Generate report
    const report = generateReport(stats);

    // Send email
    await sendEmail({
      to: 'admin@library.com',
      subject: 'Weekly Library Report',
      body: report,
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to send report:', error);
    return { success: false };
  }
}

function generateReport(stats: any[]): string {
  // Your report generation logic
  return `Weekly Report\n${JSON.stringify(stats, null, 2)}`;
}

async function sendEmail(params: any): Promise<void> {
  // Your email logic
}
```

### Register Unbound Actions

**Auto-registration via plugin:**

```javascript
// In library's cds-plugin.js
const operations = fs.readdirSync(path.join(handlersPath, 'operations'));

for (const opFile of operations) {
  const actionName = path.basename(opFile, '.ts');
  const handler = require(path.join(handlersPath, 'operations', opFile)).default;
  
  srv.on(actionName, handler);
  console.log(`Registered action: ${actionName}`);
}
```

---

## 🔧 Functions

### Define in CDS

```cds
// srv/catalog-service/catalog-service.cds
service CatalogService {
  // Functions
  function searchBooks(query: String) returns array of Books;
  function getStatistics() returns {
    total: Integer;
    available: Integer;
    borrowed: Integer;
  };
}
```

### Implement in Operations File

```typescript
// srv/catalog-service/handlers/operations/searchBooks.ts
import type { Request } from '@sap/cds';

export default async function searchBooks(req: Request) {
  const { query } = req.data;

  if (!query || query.length < 3) {
    req.error(400, 'Query must be at least 3 characters');
  }

  // Search in title and author
  const books = await SELECT.from('Books')
    .where(`title like '%${query}%' or author.name like '%${query}%'`)
    .columns('ID', 'title', 'author.name as authorName', 'status')
    .limit(20);

  return books;
}
```

```typescript
// srv/catalog-service/handlers/operations/getStatistics.ts
import type { Request } from '@sap/cds';

export default async function getStatistics(req: Request) {
  // Get total count
  const totalResult = await SELECT.from('Books').columns('count(*) as count');
  const total = totalResult[0]?.count || 0;

  // Get available count
  const availableResult = await SELECT.from('Books')
    .columns('count(*) as count')
    .where({ status: 'AVAILABLE' });
  const available = availableResult[0]?.count || 0;

  // Get borrowed count
  const borrowedResult = await SELECT.from('Books')
    .columns('count(*) as count')
    .where({ status: 'BORROWED' });
  const borrowed = borrowedResult[0]?.count || 0;

  return {
    total,
    available,
    borrowed,
  };
}
```

---

## 🔌 External Services

### Configure External Services

```json
// srv/catalog-service/handlers.config.json
{
  "externalServices": [
    "API_BUSINESS_PARTNER",
    "API_PRODUCT_SRV"
  ]
}
```

### Use in Handler

```typescript
import { BaseHandler, TypedRequest } from 'cap-handler-framework';

export default class BooksHandler extends BaseHandler {
  getEntityName() { return 'Books'; }

  async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
    const result = await next();
    const rows = this.toArray(result);

    // Get external service
    const bpApi = this.getExternalService('API_BUSINESS_PARTNER');

    if (!bpApi) {
      this.logger.warn('BusinessPartner API not available');
      return this.formatResponse(rows, req);
    }

    // Enrich with external data
    const publisherIds = [...new Set(rows.map(r => r.publisher_ID).filter(Boolean))];

    if (publisherIds.length > 0) {
      const publishers = await bpApi.run(
        SELECT.from('A_BusinessPartner')
          .where({ BusinessPartner: { in: publisherIds } })
      );

      const publisherMap = new Map(
        publishers.map(p => [p.BusinessPartner, p])
      );

      rows.forEach(row => {
        row.publisher = publisherMap.get(row.publisher_ID) || null;
      });
    }

    return this.formatResponse(rows, req);
  }
}
```

---

## 🛠️ Utilities

### Create Utility

```typescript
// srv/catalog-service/handlers/utils/SequenceManager.ts
export class SequenceManager {
  async getNextBookNumber(): Promise<string> {
    const result = await SELECT.one
      .from('Sequences')
      .where({ name: 'BookNumber' });

    const current = result?.current || 0;
    const next = current + 1;

    await UPDATE('Sequences')
      .set({ current: next })
      .where({ name: 'BookNumber' });

    return `BOOK-${String(next).padStart(6, '0')}`;
  }
}
```

### Register Utility

```json
// srv/catalog-service/handlers.config.json
{
  "utilities": {
    "sequenceManager": "./handlers/utils/SequenceManager"
  }
}
```

### Use in Handler

```typescript
export default class BooksHandler extends BaseHandler {
  getEntityName() { return 'Books'; }

  async beforeCreate(req: TypedRequest): Promise<void> {
    const sequenceManager = this.getUtility('sequenceManager');

    if (sequenceManager) {
      req.data.bookNumber = await sequenceManager.getNextBookNumber();
    }
  }
}
```

---

## 🚀 Advanced Features

### 1. ExpandTree (Performance Optimization)

```typescript
async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
  // Initialize ONCE at start
  this.initializeExpandTree(req);

  const result = await next();

  // Only enrich if actually expanded
  if (this.isExpanded('author')) {
    await this.enrichAuthor(result);
  }

  if (this.isExpanded('reviews')) {
    await this.enrichReviews(result);
  }

  return result;
}
```

### 2. Virtual Element Filtering

```typescript
async onCustomQuery(req: TypedRequest): Promise<any> {
  // Strip virtual elements before executing
  const cleanQuery = this.stripVirtualElements(req.query);

  const result = await this.db.run(cleanQuery);

  return result;
}
```

### 3. Handler Factory (Cross-Handler Communication)

```typescript
import HandlerFactory from 'cap-handler-framework';

export default class OrdersHandler extends BaseHandler {
  getEntityName() { return 'Orders'; }

  async afterCreate(data: any, req: TypedRequest): Promise<void> {
    // Get another handler via factory
    const factory = HandlerFactory.getInstance();
    const booksHandler = factory.getBooksHandler();

    // Use other handler's logic
    for (const item of data.items) {
      await booksHandler.updateStock(item.book_ID, -item.quantity);
    }
  }
}
```

### 4. Deep Copy

```typescript
async onDuplicate(req: TypedRequest): Promise<any> {
  const original = await SELECT.one.from('Orders').where(req.params[0]);

  // Deep copy with compositions
  const copy = await this.deepCopy(original, {
    excludeFields: ['createdAt', 'createdBy'],
    generateNewIds: true,
    fieldTransformers: {
      status: () => 'DRAFT',
      orderNumber: () => null,
    },
  });

  const result = await INSERT.into('Orders').entries(copy);

  return result;
}
```

### 5. Performance Logging

```typescript
async onComplexOperation(req: TypedRequest): Promise<any> {
  return await this.logPerformance('ComplexOperation', async () => {
    // Your complex logic
    await this.step1();
    await this.step2();
    await this.step3();

    return result;
  });
}
// Logs: [Books] ComplexOperation completed in 1234ms
```

---

## 📚 Complete Examples

See the following complete examples in the project:

- **`TradeSlipsHandler.ts`** - Complex entity with drafts, actions, enrichment
- **`OpportunitiesHandler.ts`** - External service integration
- **`BusinessPartnersProxyHandler.ts`** - Proxy pattern for external APIs

---

## 🐛 Troubleshooting

### Handlers niet geregistreerd?

**Check:**
1. Folder structuur correct? `srv/<service>/handlers/entities/`
2. Handler extends `BaseHandler`?
3. `getEntityName()` geïmplementeerd?
4. Default export? `export default class ...`

**Debug:**
```bash
cds watch --debug
# Check console voor handler registration logs
```

### Action niet gevonden?

**Check:**
1. CDS definitie correct?
2. Method naam correct? (`onBorrow` voor `action borrow`)
3. Operations in `handlers/operations/` folder?

### External service niet beschikbaar?

**Check:**
1. Service in `handlers.config.json`?
2. Destination configured in `.cdsrc.json`?
3. `this.getExternalService('API_NAME')` returns value?

---

## 📖 More Resources

- [NPM Library Proposal](./NPM_LIBRARY_PROPOSAL.md)
- [Optimized Service Registration](./OPTIMIZED_SERVICE_REGISTRATION.md)
- [Factory Pattern Usage](./FACTORY_PATTERN_USAGE.md)
- [Advanced query utilities](./ADVANCED_QUERY_UTILITIES.md)

---

**Happy Coding! 🎉**

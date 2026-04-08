# Actions and Functions

This document explains how to implement bound and unbound OData actions and functions
using the `cap-handler-framework`.

---

## Overview

| CDS declaration | Location in CDS | Base class | Method prefix | CAP registration |
|---|---|---|---|---|
| `action Foo()` inside entity `actions {}` | Bound to entity | `BaseHandler` | `onBoundAction_Foo` | `srv.on('Foo', Entity, handler)` |
| `function Foo()` inside entity `actions {}` | Bound to entity | `BaseHandler` | `onBoundFunction_Foo` | `srv.on('Foo', Entity, handler)` |
| `action Foo()` at service level | **Unbound** | `OperationHandler` | `onUnboundAction_Foo` | `srv.on('Foo', handler)` |
| `function Foo()` at service level | **Unbound** | `OperationHandler` | `onUnboundFunction_Foo` | `srv.on('Foo', handler)` |

---

## Bound Actions and Functions

Bound actions/functions are declared inside the `actions {}` block of an entity:

```cds
service MyService {
  entity TradeSlips as projection on db.TradeSlip
    actions {
      action DuplicateTradeSlip() returns TradeSlips;
      action CreateSalesQuotation() returns String;
    };
}
```

Implement them in the entity's `BaseHandler` subclass using the `onBoundAction_<Name>` or
`onBoundFunction_<Name>` naming convention:

```typescript
export default class TradeSlipsHandler extends BaseHandler {
  getEntityName() { return 'TradeSlips'; }

  async onBoundAction_DuplicateTradeSlip(req: TypedRequest): Promise<any> {
    const keyData = req.params[0];  // entity key from URL
    // ... implementation
  }

  async onBoundFunction_GetSummary(req: TypedRequest): Promise<any> {
    // ... implementation
  }
}
```

### Draft support for bound actions

If `shouldHandleDrafts()` returns `true`, the framework automatically registers the
bound action on both the active entity **and** `Entity.drafts`:

```ts
srv.on('DuplicateTradeSlip', 'TradeSlips', handler)
srv.on('DuplicateTradeSlip', 'TradeSlips.drafts', handler)
```

This ensures the action fires correctly when the user triggers it while a draft is open
(`IsActiveEntity=false`).

---

## Unbound Actions and Functions

Unbound actions/functions are declared **directly inside the service block** — NOT inside
any entity's `actions {}` block:

```cds
service MyService {
  entity TradeSlips as projection on db.TradeSlip { ... };

  // ← declared at service level, NOT inside TradeSlips.actions
  action CreateWithReference(quote_ID: String) returns TradeSlips;
  function GetStatistics() returns Statistics;
}
```

### ⚠️ Common mistake

Putting an unbound action handler inside an entity handler (`BaseHandler`) and using
`onBoundAction_*` will cause incorrect registration (`srv.on(event, Entity, handler)`)
instead of the required service-level registration (`srv.on(event, handler)`).

Always use `OperationHandler` + `onUnboundAction_*` for service-level operations.

---

## Implementing Unbound Actions/Functions

### Step 1 — Create the handler file

Place it in `handlers/operations/`:

```
handlers/
├── entities/
├── operations/
│   └── CreateWithReferenceHandler.ts   ← here
├── proxies/
└── index.ts
```

### Step 2 — Extend `OperationHandler`

```typescript
// handlers/operations/CreateWithReferenceHandler.ts

import cds from '@sap/cds';
import { OperationHandler, TypedRequest } from 'cap-handler-framework';

export default class CreateWithReferenceHandler extends OperationHandler {
  /**
   * Handles: action CreateWithReference(quote_ID: String) returns TradeSlips;
   * CAP registration: srv.on('CreateWithReference', handler)
   */
  async onUnboundAction_CreateWithReference(req: TypedRequest): Promise<any> {
    const { quote_ID } = req.data;

    if (!quote_ID) {
      req.error(400, 'No quotation selected');
      return;
    }

    const tx = this.tx(req);
    const quote = await tx.run(
      SELECT.one.from('MyService.Quotes').where({ SalesQuotation: quote_ID })
    );

    if (!quote) {
      req.error(404, `Quotation '${quote_ID}' not found`);
      return;
    }

    const newEntry = {
      ID: cds.utils.uuid(),
      customerNumber: quote.SoldToParty,
    };

    await tx.run(INSERT.into('MyService.TradeSlips').entries(newEntry));
    return newEntry;
  }
}
```

### Step 3 — Add to `HANDLER_CLASSES`

```typescript
// handlers/index.ts

import CreateWithReferenceHandler from './operations/CreateWithReferenceHandler';

export const HANDLER_CLASSES = [
  // Entity handlers
  TradeSlipsHandler,
  // ...

  // Operation handlers (unbound actions/functions)
  CreateWithReferenceHandler,

  // Proxy handlers
  // ...
];
```

That's it — the framework automatically calls `srv.on('CreateWithReference', handler)`.

---

## Multiple unbound operations

You can put multiple unbound operations in a single handler class, or split them into
separate files — whatever makes logical sense:

```typescript
// handlers/operations/ReportingHandler.ts

export default class ReportingHandler extends OperationHandler {
  async onUnboundFunction_GetStatistics(req: TypedRequest): Promise<any> {
    // ...
  }

  async onUnboundFunction_GetSalesSummary(req: TypedRequest): Promise<any> {
    // ...
  }
}
```

Or one file per operation:

```
handlers/operations/
├── CreateWithReferenceHandler.ts
├── GetStatisticsHandler.ts
└── ImportFromExcelHandler.ts
```

All must be added to `HANDLER_CLASSES`.

---

## Legacy convention (backward compat)

The `on<ActionName>` naming still works for methods whose name matches an action found
in `entity.actions` (bound) or `srv.actions` (unbound):

```typescript
// Legacy — still supported but deprecated
async onDuplicateTradeSlip(req) { ... }   // auto-detected as bound action
async onCreateWithReference(req) { ... }  // auto-detected as unbound action
```

A deprecation warning is logged. Prefer the explicit `onBoundAction_*` / `onUnboundAction_*`
prefixes for clarity.

---

## How the framework detects bound vs unbound

`parseMethodName()` in `HandlerRegistry` works as follows:

1. If the method name starts with `onBoundAction_` → **bound action** on the entity's entity
2. If the method name starts with `onUnboundAction_` → **unbound action** at service level
3. If the method name starts with `onBoundFunction_` → **bound function** on the entity
4. If the method name starts with `onUnboundFunction_` → **unbound function** at service level
5. If none of the above and phase is `on`, checks `entity.actions` then `srv.actions` (legacy)

For unbound handlers, the registration is:
```ts
srv.on(event, boundHandler)   // no entity argument
```

For bound handlers:
```ts
srv.on(event, entityName, boundHandler)
srv.on(event, entityName + '.drafts', boundHandler)  // if shouldHandleDrafts()=true
```

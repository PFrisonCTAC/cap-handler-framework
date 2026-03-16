# Actions and Functions

This document explains how to handle OData **actions** and **functions** using the handler framework.

---

## Concepts

| Concept | OData | CDS | Has side effects? | Has entity binding? |
|---------|-------|-----|-------------------|---------------------|
| Bound action | `POST .../Entity(key)/ActionName` | `entity.actions { action X() }` | Yes | Yes |
| Unbound action | `POST .../ServiceName/ActionName` | `service S { action X() }` | Yes | No |
| Bound function | `GET .../Entity(key)/FunctionName()` | `entity.actions { function X() }` | No | Yes |
| Unbound function | `GET .../ServiceName/FunctionName()` | `service S { function X() }` | No | No |

In CAP, actions and functions are both registered via `srv.on('ActionName', ...)`.

---

## CDS definitions (examples)

```cds
service OpportunityManagementService {

  entity TradeSlips as projection on offerstool.TradeSlip {
    *,
    ...
  }
  actions {
    // Bound action — called on a specific TradeSlip
    action DuplicateTradeSlip() returns TradeSlips;
  };

  // Unbound action — called on the service itself
  action CreateWithReference(quote_ID: UUID) returns String;

  // Bound function — read-only, called on a specific TradeSlipItem
  // (would be defined as: extend projection TradeSlipItem with actions { function GetSummary() ... })

  // Unbound function
  function GetServiceStats() returns String;
}
```

---

## Naming convention

### Preferred (explicit)

```
onBoundAction_<ActionName>       Bound action on the handler's entity
onUnboundAction_<ActionName>     Unbound action on the service
onBoundFunction_<FunctionName>   Bound function on the handler's entity
onUnboundFunction_<FunctionName> Unbound function on the service
```

### Legacy (backward-compatible auto-detection)

```
on<ActionName>
```

If the method name doesn't match a standard lifecycle event (`onRead`, `onCreate`, …), the registry checks whether `<ActionName>` exists as an entity-level or service-level action in the CDS model. If found, it is auto-registered.

> **Recommendation:** Use the explicit `onBoundAction_` / `onUnboundAction_` prefix. It makes the intent immediately clear and eliminates any ambiguity with lifecycle methods.

---

## Bound action

Registered as: `srv.on('<ActionName>', entity, handler)`

```typescript
// srv/opportunity-management/handlers/entities/TradeSlipsHandler.ts

export default class TradeSlipsHandler extends BaseHandler {
  getEntityName() { return 'TradeSlips'; }

  /**
   * Bound action: POST /odata/v4/opportunity-management/TradeSlips(ID=...)/DuplicateTradeSlip
   */
  async onBoundAction_DuplicateTradeSlip(req: TypedRequest): Promise<any> {
    const keyData = req.params[0]; // { ID: '550e8400-...' }
    const tx = this.tx(req);

    const original = await tx.run(
      SELECT.one.from('OpportunityManagementService.TradeSlips').where(keyData)
    );

    if (!original) return req.error(404, 'TradeSlip not found');

    const copy = await this.deepCopy(original);
    copy.tradeSlipIndex = await this.sequenceManager.nextIndex();

    await tx.run(INSERT.into('OpportunityManagementService.TradeSlips').entries(copy));
    this.logger.info(`Duplicated TradeSlip ${original.tradeSlipIndex} → ${copy.tradeSlipIndex}`);
    return copy;
  }
}
```

**OData call:**
```http
POST /odata/v4/opportunity-management/TradeSlips(ID=550e8400-e29b-41d4-a716-446655440001)/DuplicateTradeSlip
Content-Type: application/json

{}
```

---

## Unbound action

Registered as: `srv.on('<ActionName>', handler)` (no entity argument)

```typescript
// srv/opportunity-management/handlers/entities/TradeSlipsHandler.ts
// (or in a dedicated handler if no entity is relevant)

export default class TradeSlipsHandler extends BaseHandler {
  getEntityName() { return 'TradeSlips'; }

  /**
   * Unbound action: POST /odata/v4/opportunity-management/CreateWithReference
   */
  async onUnboundAction_CreateWithReference(req: TypedRequest): Promise<any> {
    const { quote_ID } = req.data;

    // Fetch the quote and create a new TradeSlip from it
    const quoteApi = this.getExternalService('API_SALES_QUOTATION_SRV');
    const quote = await quoteApi.run(
      SELECT.one.from('A_SalesQuotation').where({ SalesQuotation: quote_ID })
    );

    if (!quote) return req.error(404, `Quote ${quote_ID} not found`);

    const newSlip = { /* ... build from quote ... */ };
    const tx = this.tx(req);
    await tx.run(INSERT.into('OpportunityManagementService.TradeSlips').entries(newSlip));

    return `Created TradeSlip from Quote ${quote_ID}`;
  }
}
```

**OData call:**
```http
POST /odata/v4/opportunity-management/CreateWithReference
Content-Type: application/json

{ "quote_ID": "550e8400-e29b-41d4-a716-446655440099" }
```

---

## Bound function

Registered as: `srv.on('<FunctionName>', entity, handler)`

```typescript
// Bound function on TradeSlipPriceCostDataItem
export default class TradeSlipPriceCostDataItemHandler extends BaseHandler {
  getEntityName() { return 'TradeSlipPriceCostDataItem'; }

  /**
   * Bound function: GET /odata/v4/opportunity-management/TradeSlipPriceCostDataItem(ID=...)/DisplayPriceCostDetails()
   */
  async onBoundFunction_DisplayPriceCostDetails(req: TypedRequest): Promise<any> {
    const { ID } = req.params[0] as any;
    const tx = this.tx(req);

    const item = await tx.run(
      SELECT.one.from('OpportunityManagementService.TradeSlipPriceCostDataItem').where({ ID })
    );

    return item;
  }
}
```

---

## Unbound function

Registered as: `srv.on('<FunctionName>', handler)` (no entity argument)

```typescript
async onUnboundFunction_GetServiceStats(req: TypedRequest): Promise<any> {
  const db = this.db;
  const count = await db.run(SELECT.from('OpportunityManagementService.TradeSlips').columns('count(*) as total'));
  return `Total TradeSlips: ${count[0]?.total ?? 0}`;
}
```

---

## Legacy auto-detection

The registry will automatically detect `on<Name>` methods that match entity actions:

```typescript
// This still works for backward compatibility:
async onDuplicateTradeSlip(req: TypedRequest): Promise<any> {
  // Auto-detected as bound action via entity.actions.DuplicateTradeSlip
}
```

A debug log message will be emitted advising you to rename to `onBoundAction_DuplicateTradeSlip`.

---

## Registration summary

```
Handler method                        Registered as
──────────────────────────────────    ────────────────────────────────────────
onBoundAction_DuplicateTradeSlip      srv.on('DuplicateTradeSlip', TradeSlips, handler)
onUnboundAction_CreateWithReference   srv.on('CreateWithReference', handler)
onBoundFunction_DisplayPriceCost...   srv.on('DisplayPriceCostDetails', TradeSlipPriceCostDataItem, handler)
onUnboundFunction_GetStats            srv.on('GetStats', handler)
onDuplicateTradeSlip (legacy)         auto-detected → srv.on('DuplicateTradeSlip', TradeSlips, handler)
```

---

## Handling action parameters

```typescript
async onBoundAction_DuplicateTradeSlip(req: TypedRequest): Promise<any> {
  // Entity key
  const key = req.params[0]; // e.g. { ID: '550e...' }

  // Action body parameters (from request body)
  const { targetDate, copyNotes } = req.data;

  // ...
}
```

---

## See also

- [HOOKS.md](./HOOKS.md) — active entity hooks
- [DRAFTS.md](./DRAFTS.md) — draft lifecycle hooks

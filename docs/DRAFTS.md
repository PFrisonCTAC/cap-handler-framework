# Draft Lifecycle Hooks

This document describes all hooks related to the **CAP draft workflow**.

---

## Prerequisites

Your entity must be draft-enabled in the CDS model:

```cds
// db/schema.cds
@odata.draft.enabled
entity TradeSlip : cuid, managed {
  ...
}
```

And your handler must opt in:

```typescript
shouldHandleDrafts(): boolean {
  return true;
}
```

---

## CAP draft flow overview

```
User clicks "New"
  → NEW event fires on active entity
  → CAP creates a row in TradeSlips.drafts (fires CREATE on entity.drafts)

User edits fields
  → PATCH events fire on TradeSlips.drafts

User clicks "Edit" (on an existing active record)
  → EDIT event fires on active entity
  → CAP copies active row to TradeSlips.drafts

User clicks "Save" / "Activate"
  → SAVE event fires on TradeSlips.drafts
  → CAP creates/updates the active entity (fires CREATE/UPDATE on TradeSlips)

User clicks "Discard"
  → CANCEL event fires on TradeSlips.drafts
  → Draft row is deleted
```

---

## Hook reference

### New draft creation

| Hook | CAP registration | When it fires |
|------|-----------------|---------------|
| `beforeNewDraft` | `before('NEW', entity)` | Before a new draft session starts (user clicks "New"). |
| `afterNewDraft` | `after('NEW', entity)` | After the NEW event completes. |
| `beforeCreateDraft` | `before('CREATE', entity.drafts)` | Before the draft row is inserted into the `.drafts` table. |
| `afterCreateDraft` | `after('CREATE', entity.drafts)` | After the draft row is inserted. |

```typescript
async beforeNewDraft(req: TypedRequest): Promise<void> {
  // Initialize default values for a brand-new draft
  req.data.currency = 'EUR';
  req.data.status = 'DRAFT';
}

async beforeCreateDraft(req: TypedRequest): Promise<void> {
  // Fires as CAP inserts the initial row into TradeSlips.drafts
  this.logger.info('Draft row created:', req.data.ID);
}
```

---

### Draft editing (PATCH)

| Hook | CAP registration | When it fires |
|------|-----------------|---------------|
| `beforePatchDraft` | `before('PATCH', entity.drafts)` | Before a field update on the draft. |
| `afterPatchDraft` | `after('PATCH', entity.drafts)` | After a field update on the draft. |

```typescript
async beforePatchDraft(req: TypedRequest): Promise<void> {
  this.logger.info('Draft patch payload:', JSON.stringify(req.data));
}

async afterPatchDraft(data: any, req: TypedRequest): Promise<void> {
  // Auto-compute derived fields after the user changes something
  const slip = this.toArray(data)[0];
  if (!slip?.customerNumber) return;

  // Auto-fill the delivery address from the first known BP address
  await this.autoFillDeliveryAddress(slip, req);
}
```

---

### Edit existing record (copy to draft)

| Hook | CAP registration | When it fires |
|------|-----------------|---------------|
| `beforeEditDraft` | `before('EDIT', entity)` | Before an active record is copied to a draft (user clicks "Edit"). |
| `afterEditDraft` | `after('EDIT', entity)` | After the edit-draft is created. |

> These hooks fire on the **active entity** because EDIT is initiated against the active record.

```typescript
async beforeEditDraft(req: TypedRequest): Promise<void> {
  // Check if editing is allowed
  const { ID } = req.params[0] as any;
  const record = await SELECT.one.from('OpportunityManagementService.TradeSlips').where({ ID });
  if (record?.status === 'CLOSED') {
    req.error(403, 'Closed records cannot be edited.');
  }
}
```

---

### Draft activation (Save → active entity)

| Hook | CAP registration | When it fires |
|------|-----------------|---------------|
| `beforeSaveDraft` | `before('SAVE', entity.drafts)` | Before the draft is activated. Use for final validation. |
| `afterSaveDraft` | `after('SAVE', entity.drafts)` | After the draft is activated. |

> **Important:** `beforeCreate` on the active entity also fires during activation (when CAP internally runs the INSERT/UPDATE on the active table). Use `beforeSaveDraft` for draft-specific pre-activation logic.

```typescript
async beforeSaveDraft(req: TypedRequest): Promise<void> {
  // Final validation before activation
  if (!req.data.customerNumber) {
    req.error(400, 'Customer Number is required before saving.');
  }
  if (!req.data.salesOrganization) {
    req.error(400, 'Sales Organization is required before saving.');
  }
}

async afterSaveDraft(data: any, req: TypedRequest): Promise<void> {
  this.logger.info(`Draft activated for TradeSlip: ${data.tradeSlipIndex}`);
}
```

---

### Draft discard (Cancel)

| Hook | CAP registration | When it fires |
|------|-----------------|---------------|
| `beforeDiscardDraft` | `before('CANCEL', entity.drafts)` | Before the draft is discarded. |
| `afterDiscardDraft` | `after('CANCEL', entity.drafts)` | After the draft is discarded. |

```typescript
async beforeDiscardDraft(req: TypedRequest): Promise<void> {
  this.logger.info(`Draft discarded for ID: ${req.params[0]}`);
  // Clean up any temporary external state here
}
```

---

## Full lifecycle example

```typescript
export default class TradeSlipsHandler extends BaseHandler {
  getEntityName() { return 'TradeSlips'; }
  shouldHandleDrafts() { return true; }

  // ── Active entity ─────────────────────────────────────────────────────────
  async beforeCreate(req: TypedRequest): Promise<void> {
    // Fires during SAVE activation (or direct non-draft create)
    req.data.tradeSlipIndex = await this.sequenceManager.nextIndex();
  }

  async afterRead(data: any, req: TypedRequest): Promise<void> {
    // Fires on BOTH active entity reads and draft detail page reads
    for (const row of this.toArray(data)) row.proCount = await this.getChildCount(row.ID);
  }

  // ── Draft lifecycle ────────────────────────────────────────────────────────
  async beforeNewDraft(req: TypedRequest): Promise<void> {
    // User clicked "New" — set defaults
    req.data.currency = 'EUR';
  }

  async beforePatchDraft(req: TypedRequest): Promise<void> {
    // User changed a field — validate in real-time
    if (req.data.quantity != null && req.data.quantity < 0) {
      req.error(400, 'Quantity cannot be negative');
    }
  }

  async afterPatchDraft(data: any, req: TypedRequest): Promise<void> {
    // Auto-compute derived fields
    await this.autoFillDeliveryAddress(this.toArray(data)[0], req);
  }

  async beforeEditDraft(req: TypedRequest): Promise<void> {
    // User clicked "Edit" on an existing record — lock check
    await this.checkEditLock(req.params[0]);
  }

  async beforeSaveDraft(req: TypedRequest): Promise<void> {
    // Final validation before activation
    if (!req.data.customerNumber) req.error(400, 'Customer required');
  }

  async beforeDiscardDraft(req: TypedRequest): Promise<void> {
    this.logger.info('Draft discarded');
  }
}
```

---

## Hook → entity target mapping

```
Method                Fires on
────────────────────  ────────────────────────────────────────
beforeNewDraft        TradeSlips          (active entity — EDIT/NEW fire on active)
afterNewDraft         TradeSlips
beforeEditDraft       TradeSlips
afterEditDraft        TradeSlips

beforeCreateDraft     TradeSlips.drafts   (draft table)
afterCreateDraft      TradeSlips.drafts
beforePatchDraft      TradeSlips.drafts
afterPatchDraft       TradeSlips.drafts
beforeSaveDraft       TradeSlips.drafts
afterSaveDraft        TradeSlips.drafts
beforeDiscardDraft    TradeSlips.drafts
afterDiscardDraft     TradeSlips.drafts
```

---

## Common mistakes

| Mistake | Correct approach |
|---------|-----------------|
| Using `beforeCreate` to initialise a new draft | Use `beforeNewDraft` or `beforeCreateDraft` instead |
| Expecting `beforeCreate` NOT to fire during activation | It does — use `beforeSaveDraft` for draft-only pre-activation logic |
| Defining `beforeEditDraft` expecting it to fire on the drafts table | EDIT fires on the active entity — `beforeEditDraft` registers on the active entity |

---

## See also

- [HOOKS.md](./HOOKS.md) — active entity hooks
- [ACTIONS_AND_FUNCTIONS.md](./ACTIONS_AND_FUNCTIONS.md) — action and function hooks

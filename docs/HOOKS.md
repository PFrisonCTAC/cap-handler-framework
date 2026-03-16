# Active Entity Lifecycle Hooks

This document describes all lifecycle hooks that fire on the **active entity** (the persisted, non-draft version of a record).

---

## Hook naming convention

```
[before|after|on]<Event>[Active?]
```

Optionally append `Active` to make the intent explicit (same behaviour as no suffix).

---

## Complete reference

### CREATE

| Hook | Signature | When it fires |
|------|-----------|---------------|
| `beforeCreate` | `(req: TypedRequest) => Promise<void>` | Before a new record is persisted to the DB. Also fires when a draft is **activated** (SAVE). |
| `afterCreate` | `(data: T, req: TypedRequest) => Promise<void>` | After the record is persisted. |

```typescript
async beforeCreate(req: TypedRequest): Promise<void> {
  req.data.tradeSlipIndex = await this.sequenceManager.nextIndex();
}

async afterCreate(data: any, req: TypedRequest): Promise<void> {
  this.logger.info(`Created record with ID: ${data.ID}`);
}
```

> **Draft note:** In a draft-enabled entity, `beforeCreate` fires during **draft activation** (when the user clicks Save/Activate), not when the draft row is first created. To run logic when the draft row is first created, use [`beforeCreateDraft`](./DRAFTS.md).

---

### READ

| Hook | Signature | When it fires |
|------|-----------|---------------|
| `beforeRead` | `(req: TypedRequest) => Promise<void>` | Before the SELECT query runs. |
| `onRead` | `(req: TypedRequest, next: () => Promise<any>) => Promise<any>` | Replaces or wraps the default READ handler. Must call `next()`. |
| `afterRead` | `(data: T \| T[], req: TypedRequest) => Promise<void>` | After data is fetched. Data can be mutated in place. |

```typescript
async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
  this.initializeExpandTree(req);
  const result = await next();
  if (this.isExpanded('businessPartner')) {
    await this.enrichBusinessPartner(result);
  }
  return result;
}

async afterRead(data: any, req: TypedRequest): Promise<void> {
  for (const row of this.toArray(data)) {
    row.displayLabel = `${row.firstName} ${row.lastName}`;
  }
}
```

> **Draft note:** When `shouldHandleDrafts()` returns `true`, `afterRead` is registered on **both** the active entity and `entity.drafts`. This ensures the hook also fires when the Fiori draft detail page reads the draft record.

---

### UPDATE

| Hook | Signature | When it fires |
|------|-----------|---------------|
| `beforeUpdate` | `(req: TypedRequest) => Promise<void>` | Before an UPDATE query runs. |
| `afterUpdate` | `(data: T, req: TypedRequest) => Promise<void>` | After the UPDATE completes. |

```typescript
async beforeUpdate(req: TypedRequest): Promise<void> {
  req.data.lastModifiedLabel = new Date().toISOString();
}
```

---

### DELETE

| Hook | Signature | When it fires |
|------|-----------|---------------|
| `beforeDelete` | `(req: TypedRequest) => Promise<void>` | Before a record is deleted. |
| `afterDelete` | `(data: T, req: TypedRequest) => Promise<void>` | After the record is deleted. |

```typescript
async beforeDelete(req: TypedRequest): Promise<void> {
  const { ID } = req.params[0] as any;
  const count = await this.count('MyChildEntity', { parent_ID: ID });
  if (count > 0) {
    req.error(409, `Cannot delete: ${count} child record(s) still exist.`);
  }
}
```

---

## Explicit `Active` suffix (optional)

Appending `Active` is equivalent to no suffix. Use it for clarity when a handler also defines draft hooks:

```typescript
async beforeCreateActive(req: TypedRequest): Promise<void> {
  // Runs on active entity CREATE only (same as beforeCreate)
}

async beforeCreateDraft(req: TypedRequest): Promise<void> {
  // Runs when the draft row is first created (NEW event)
}
```

---

## Handler registration summary

```
Entity: TradeSlips (shouldHandleDrafts = true)

Method             Registered on
───────────────    ─────────────────────────────────
beforeCreate       TradeSlips (active)
afterCreate        TradeSlips (active)
beforeRead         TradeSlips (active)
onRead             TradeSlips (active)
afterRead          TradeSlips (active) + TradeSlips.drafts
beforeUpdate       TradeSlips (active)
afterUpdate        TradeSlips (active)
beforeDelete       TradeSlips (active)
afterDelete        TradeSlips (active)
```

---

## See also

- [DRAFTS.md](./DRAFTS.md) — draft lifecycle hooks
- [ACTIONS_AND_FUNCTIONS.md](./ACTIONS_AND_FUNCTIONS.md) — action and function hooks

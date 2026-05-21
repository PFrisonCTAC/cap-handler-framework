# Service Layer Guide

This guide explains the service layer pattern used in CAP projects that build on `cap-handler-framework`.

---

## Why a service layer?

Handlers grow large when they contain inline CQL queries. A service layer:
- Gives each query a descriptive name (readable in call sites)
- Makes query logic reusable across handlers without copy-paste
- Keeps handlers focused on orchestration and business rules

**Rule of thumb:** reads go in services; request-scoped writes stay in the handler.

---

## Two kinds of services

### 1. Local DB services — `extends DBService`

Use for entities that live in your CAP database (local model).

```
services/DB/
├── DBService.ts          ← base class (connects to 'db')
└── {EntityName}Service.ts
```

**Template:**

```typescript
// services/DB/TradeSlipsService.ts
import DBService from './DBService';

export default class TradeSlipsService extends DBService {
  constructor() {
    super(); // calls DBService → BaseService('db')
  }

  public async getSlipIndexesByIds(ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const { TradeSlips } = this.getService().entities as any;
    return this.getService().run(
      SELECT.from(TradeSlips).columns('ID', 'tradeSlipIndex').where({ ID: { in: ids } })
    );
  }
}
```

**Reads that must run in the handler's transaction** (e.g. draft tables during a patch) accept an explicit `tx` parameter:

```typescript
public async getItemDraftsBySlipId(slipId: string, tx: any): Promise<any[]> {
  const { TradeSlipItem } = this.getService().entities as any;
  const result = await tx.run(
    SELECT.from(TradeSlipItem.drafts).where({ tradeSlip: slipId })
  );
  return Array.isArray(result) ? result : result ? [result] : [];
}
```

### 2. External OData services — `extends BaseService`

Use for remote APIs registered in `cds.requires` (e.g. `API_BUSINESS_PARTNER`).

```
services/{ExternalServiceName}/
└── {EntityName}Service.ts
```

The folder name **must match** the key in `cds.requires` / `package.json`.

**Template:**

```typescript
// services/API_BUSINESS_PARTNER/AddressesService.ts
import { BaseService } from 'cap-handler-framework';

export default class AddressesService extends BaseService {
  constructor() {
    super('API_BUSINESS_PARTNER'); // cds.connect.to('API_BUSINESS_PARTNER')
  }

  public async getFirstAddressForBP(bpId: string): Promise<any | null> {
    const { A_BusinessPartnerAddress } = this.getService().entities;
    const result = await this.getService().run(
      SELECT.from(A_BusinessPartnerAddress)
        .columns(['BusinessPartner', 'AddressID'])
        .where({ BusinessPartner: bpId })
        .orderBy('AddressID')
        .limit(1)
    );
    const first = Array.isArray(result) ? result[0] : result;
    return first ?? null;
  }
}
```

---

## `getInstance()` — singleton factory

`BaseService.getInstance(ServiceClass)` returns a singleton that is already connected to its CDS service. It is safe to call multiple times — the same instance is returned after the first call.

```typescript
// single service
const addrSvc = await BaseService.getInstance(AddressesService);
const first = await addrSvc.getFirstAddressForBP(bpId);

// multiple services in parallel
const [addrSvc, bpSvc] = await Promise.all([
  BaseService.getInstance(AddressesService),
  BaseService.getInstance(BusinessPartnersService),
]);
```

### In tests

Call `BaseService.reset()` in `beforeEach` / `afterEach` to clear all cached instances between test cases.

---

## What belongs in a service vs a handler

| Operation | Where |
|---|---|
| SELECT (read) | Service method |
| SELECT inside a request transaction (draft reads) | Service method with explicit `tx` parameter |
| INSERT / UPDATE / DELETE (write) | Inline in handler via `this.tx(req)` |
| Business validation logic | Inline in handler |
| Orchestration (call A then call B) | Inline in handler |

The reason writes stay in the handler: they are tied to the request transaction (`this.tx(req)`) and must be rolled back atomically if the handler fails. Services have no access to the request object.

---

## Naming conventions

| What | Convention | Example |
|---|---|---|
| DB service folder | `services/DB/` | `services/DB/` |
| External service folder | `services/{ServiceKey}/` | `services/API_BUSINESS_PARTNER/` |
| File name | `{EntityName}Service.ts` | `AddressesService.ts` |
| Class name | `{EntityName}Service` | `AddressesService` |
| Constructor arg (external) | exact `cds.requires` key | `'API_BUSINESS_PARTNER'` |

---

## DBService

`DBService` is the base class for all local DB services. It extends `BaseService` with `'db'` as the service name, which resolves to `cds.db` at runtime.

```typescript
// services/DB/DBService.ts
import { BaseService } from 'cap-handler-framework';
const cds = require(require.resolve('@sap/cds', { paths: [process.cwd()] }));

export default class DBService extends BaseService {
  protected db: any;
  constructor() {
    super('db');
    this.db = cds.db;
  }
  public getDB(): any { return this.db; }
  public getEntity(serviceEntity: string): any {
    return this.getService().model.definitions[serviceEntity];
  }
}
```

The `require.resolve` pattern prevents a "loaded from two locations" error when `cap-handler-framework` is installed as a symlinked `file:` dependency.

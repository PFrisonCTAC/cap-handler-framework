# Service Layer Guide

This guide explains the service layer pattern used in CAP projects that build on `cap-handler-framework`.

---

## Why a service layer?

Handlers grow large when they contain inline CQL queries. A service layer:

- Gives each query a descriptive name (readable at call sites)
- Makes query logic reusable across handlers without copy-paste
- Keeps handlers focused on orchestration and business rules
- Makes external API calls independently unit-testable

**Rule of thumb:** reads go in services; request-scoped writes stay in the handler.

---

## Two kinds of services

### 1. Local DB services — `extends DBService`

Use for entities that live in your CAP database (local model).

```
services/DB/
├── DBService.ts               ← project-level base (connects to 'db', provides oms getter)
└── {EntityName}Service.ts
```

**Template:**

```typescript
// services/DB/TradeSlipsService.ts
import DBService from './DBService';

export default class TradeSlipsService extends DBService {
  public async getSlipIndexesByIds(ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const { TradeSlips } = this.oms;
    return this.getService().run(
      SELECT.from(TradeSlips).columns('ID', 'tradeSlipIndex').where({ ID: { in: ids } })
    );
  }
}
```

**Reads that must run in the handler's request transaction** (e.g. reading draft tables during a PATCH) accept an explicit `tx` parameter:

```typescript
public async getPricingDraftByItemId(itemId: string, tx: any): Promise<any | null> {
  const { TradeSlipPriceCostDataItem } = this.oms;
  const result = await tx.run(
    SELECT.one.from(TradeSlipPriceCostDataItem.drafts).where({ tradeSlipItem_ID: itemId })
  );
  return result ?? null;
}
```

#### Why `this.oms` instead of `cds.db.entities`?

`DBService` exposes a protected `oms` getter that returns `cds.services['OpportunityManagementService']?.entities`. Two reasons why `cds.db.entities` cannot be used instead:

1. **Short names**: `cds.db` only recognises fully-qualified names (`'OpportunityManagementService.TradeSlips'`). Short names like `TradeSlips` are always `undefined` in `cds.db.entities`.
2. **`.drafts`**: The `.drafts` property is a runtime construct attached by CAP when the ApplicationService registers draft-enabled entities. It exists on `cds.services['OMS'].entities.TradeSlips.drafts` — never on `cds.db.entities`.

Query **execution** still goes through `cds.db` (= `this.getService()`) to bypass the handler chain. Running a query on `cds.services['OMS']` would trigger `afterRead` on every entity handler, causing infinite recursion for handlers that call service methods from `afterRead`.

---

### 2. External OData services — `extends BaseService`

Use for remote APIs registered in `cds.requires` (e.g. `API_BUSINESS_PARTNER`).

```
services/{ExternalServiceKey}/
└── {EntityName}Service.ts
```

The folder name should match the key in `cds.requires` / `package.json` for discoverability — it is not enforced.

**Template:**

```typescript
// services/API_BUSINESS_PARTNER/AddressesService.ts
import { BaseService } from 'cap-handler-framework';

export default class AddressesService extends BaseService {
  constructor() {
    super('API_BUSINESS_PARTNER'); // resolves via cds.connect.to()
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

**Returning arrays — normalise consistently:**

```typescript
const result = await this.getService().run(...);
return Array.isArray(result) ? result : result ? [result] : [];
```

---

## `getInstance()` — singleton factory

`BaseService.getInstance(ServiceClass)` returns a singleton that is already connected to its CDS service. Calling it multiple times is free — the cached instance is returned after the first call.

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

**`getInstances()`** is a convenience wrapper for the parallel case:

```typescript
const [addrSvc, bpSvc] = await BaseService.getInstances([AddressesService, BusinessPartnersService]);
```

---

## Bypassing to the service handle for complex queries

When a handler needs a query that is too specific to justify a service method (e.g. dynamic WHERE built from the OData request), retrieve the underlying CDS service handle and run the query directly:

```typescript
// Handler — custom query that does not belong in a reusable service method
const svc = await BaseService.getInstance(CustomerSalesAreasService);
const api = svc.getService();  // raw CDS service handle

let query = SELECT.from(api.entities.A_CustomerSalesArea)
  .columns(this.getSelectableFields())
  .where({ SalesOffice: { '!=': '' } });

query = this.applyOriginalFilters(query, originalQuery); // handler-specific logic

const raw = await api.run(query);
```

---

## Error handling — Pattern C (mandatory)

Services **never** catch exceptions — they throw and let the caller decide. Handlers **always** catch with `req.error(statusCode, message)`.

```typescript
// ✅ Correct — service throws, handler catches
async beforePatchDraft(data: any, req: TypedRequest): Promise<void> {
  let addrSvc: AddressesService;
  try {
    addrSvc = await BaseService.getInstance(AddressesService);
  } catch (err: any) {
    this.logger.error('Handler: could not connect to address service:', err?.message);
    req.error(503, 'Address service not available.');
    return;
  }

  let address: any;
  try {
    address = await addrSvc.getFirstAddressForBP(bpId);
  } catch (err: any) {
    this.logger.error(`Handler: address lookup failed for ${bpId}:`, err?.message);
    req.error(503, 'Address service not available.');
    return;
  }
  // ...
}

// ❌ Wrong — service swallows errors silently
public async getFirstAddressForBP(bpId: string): Promise<any | null> {
  try {
    // ...
  } catch {
    return null; // ← hides failures, handler can't react
  }
}
```

**Logging levels in handlers:**

| Level | When | Format |
|---|---|---|
| `info` | Normal flow, key state changes | `'Handler: action — id/value'` |
| `warn` | Missing / empty data (non-critical) | `'Handler: no field found for id'` |
| `error` | External API / DB failure | `'Handler: action failed for id:', err?.message` |

Services have **no logger** — they throw, the handler logs.

---

## What belongs in a service vs. a handler

| Operation | Where | Why |
|---|---|---|
| `SELECT` (read) | Service method | Reusable, testable in isolation |
| `SELECT` inside a request transaction | Service method with explicit `tx` parameter | Scoped to the request, still reusable |
| `INSERT` / `UPDATE` / `DELETE` | Inline in handler via `this.tx(req)` | Must roll back atomically on failure |
| Orchestration (call A then B then C) | Inline in handler | Handler-specific logic, not reusable |
| Business validation | Inline in handler | Validation belongs next to the mutation |
| Complex dynamic query built from `req.query` | Inline in handler via `svc.getService()` | Too handler-specific for a service method |

---

## Naming conventions

| What | Convention | Example |
|---|---|---|
| DB service folder | `services/DB/` | `services/DB/` |
| External service folder | `services/{ServiceKey}/` | `services/API_BUSINESS_PARTNER/` |
| File name | `{EntityName}Service.ts` | `AddressesService.ts` |
| Class name | `{EntityName}Service` | `AddressesService` |
| Constructor arg (external) | exact `cds.requires` key | `'API_BUSINESS_PARTNER'` |
| Method prefix | verb describing the operation | `getByIds`, `getForMaterial`, `getCountsByItemIds` |

---

## DBService

`DBService` is the project-level base class for all local DB services. It extends `BaseService('db')` and adds:

- `getDB()` — raw reference to `cds.db`
- `oms` getter — entity references from the ApplicationService (short names + `.drafts`)

```typescript
import { BaseService } from 'cap-handler-framework';
const cds = require(require.resolve('@sap/cds', { paths: [process.cwd()] }));

export default class DBService extends BaseService {
  protected db: any;
  constructor() {
    super('db');
    this.db = cds.db;
  }
  public getDB(): any { return this.db; }

  protected get oms(): any {
    const entities = cds.services['OpportunityManagementService']?.entities;
    if (!entities) throw new Error('OpportunityManagementService not yet registered');
    return entities;
  }
}
```

The `require.resolve` pattern ensures the framework and the host application share the same `@sap/cds` instance (prevents "loaded from two locations" errors with `file:` symlinks).

---

## Testing

### Unit tests — mock `getService()`

```typescript
import AddressesService from '../../../srv/opportunity-management/services/API_BUSINESS_PARTNER/AddressesService';

describe('AddressesService.getFirstAddressForBP', () => {
  let svc: AddressesService;
  let mockRun: jest.Mock;

  beforeEach(() => {
    svc = new AddressesService();
    mockRun = jest.fn();
    jest.spyOn(svc, 'getService').mockReturnValue({
      entities: { A_BusinessPartnerAddress: 'A_BusinessPartnerAddress' },
      run: mockRun,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns address when found', async () => {
    mockRun.mockResolvedValue([{ BusinessPartner: 'BP001', AddressID: '001' }]);
    const result = await svc.getFirstAddressForBP('BP001');
    expect(result?.AddressID).toBe('001');
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('returns null when not found', async () => {
    mockRun.mockResolvedValue(null);
    expect(await svc.getFirstAddressForBP('BP999')).toBeNull();
  });

  it('propagates exceptions', async () => {
    mockRun.mockRejectedValue(new Error('API down'));
    await expect(svc.getFirstAddressForBP('BP001')).rejects.toThrow('API down');
  });
});
```

**For DB services**, mock both `getService()` and the `oms` getter:

```typescript
beforeEach(() => {
  svc = new TradeSlipsService();
  mockRun = jest.fn();
  jest.spyOn(svc, 'getService').mockReturnValue({ run: mockRun });
  Object.defineProperty(svc, 'oms', {
    get: () => ({
      TradeSlips: { name: 'TradeSlips' },
      TradeSlipItem: { name: 'TradeSlipItem', drafts: { name: 'TradeSlipItem.drafts' } },
    }),
    configurable: true,
  });
});
```

### Integration tests — mock the CDS service singleton

`cds.connect.to()` returns a cached singleton. `jest.spyOn` on that instance intercepts calls from the service layer because it uses the same object reference:

```typescript
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds');

let bpApi: any;

beforeAll(async () => {
  bpApi = await cds.connect.to('API_BUSINESS_PARTNER'); // cache the singleton
});

afterEach(() => jest.restoreAllMocks());

it('should populate address on delivery BP change', async () => {
  jest.spyOn(bpApi, 'run').mockImplementation(async (query: any) => {
    const src = JSON.stringify(query?.SELECT ?? '');
    if (src.includes('A_BusinessPartnerAddress')) {
      return [{ BusinessPartner: 'BP001', AddressID: 'A001' }];
    }
    return [];
  });

  const { status } = await test.PATCH(
    `/odata/v4/opportunity-management/TradeSlips(ID=${slipId},IsActiveEntity=false)`,
    { deliveryBusinessPartner: 'BP001' }
  );
  expect(status).toBe(200);
});
```

**Error responses from `cds.test()`** throw AxiosError for non-2xx — use `.catch()`:

```typescript
const err: any = await test.PATCH(url, data).catch((e: any) => e);
expect(err?.response?.status ?? err?.status).toBe(503);
```

### Reset between tests

`BaseService.reset()` clears all cached instances. Call it in `afterEach` if tests need fresh instances:

```typescript
afterEach(() => {
  BaseService.reset();
  jest.restoreAllMocks();
});
```

---

## Complete example — adding a new service

### 1. Create the service file

```typescript
// services/API_PRODUCT_SRV/ProductDescriptionsService.ts
import { BaseService } from 'cap-handler-framework';

export default class ProductDescriptionsService extends BaseService {
  constructor() {
    super('API_PRODUCT_SRV');
  }

  public async getForMaterial(materialId: string, lang: string): Promise<any | null> {
    const { A_ProductDescription } = this.getService().entities;
    const result = await this.getService().run(
      SELECT.one
        .from(A_ProductDescription)
        .columns('Product', 'ProductDescription')
        .where({ Product: materialId, Language: lang })
    );
    return result ?? null;
  }

  public async getForMaterials(materialIds: string[], lang: string): Promise<any[]> {
    if (!materialIds.length) return [];
    const { A_ProductDescription } = this.getService().entities;
    const result = await this.getService().run(
      SELECT.from(A_ProductDescription)
        .columns('Product', 'ProductDescription')
        .where({ Product: { in: materialIds }, Language: lang })
    );
    return Array.isArray(result) ? result : result ? [result] : [];
  }
}
```

### 2. Use in a handler — Pattern C

```typescript
import { BaseService } from 'cap-handler-framework';
import ProductDescriptionsService from '../../services/API_PRODUCT_SRV/ProductDescriptionsService';

// Inside an afterPatchDraft handler:
if (!req.data.materialID) {
  data.materialDescription = null;
  return;
}

let desc: any;
try {
  const svc = await BaseService.getInstance(ProductDescriptionsService);
  desc = await svc.getForMaterial(req.data.materialID, 'EN');
} catch (err: any) {
  this.logger.error(`TradeSlipItemHandler: description lookup failed for ${req.data.materialID}:`, err?.message);
  req.error(500, 'Product description could not be loaded.');
  return;
}

const tx = this.tx(req);
await tx.run(
  UPDATE(TradeSlipItem.drafts)
    .set({ materialDescription: desc?.ProductDescription ?? null })
    .where({ ID: data.ID })
);
```

### 3. Write the unit test

```typescript
import ProductDescriptionsService from '../../../srv/opportunity-management/services/API_PRODUCT_SRV/ProductDescriptionsService';

describe('ProductDescriptionsService.getForMaterial', () => {
  let svc: ProductDescriptionsService;
  let mockRun: jest.Mock;

  beforeEach(() => {
    svc = new ProductDescriptionsService();
    mockRun = jest.fn();
    jest.spyOn(svc, 'getService').mockReturnValue({
      entities: { A_ProductDescription: 'A_ProductDescription' },
      run: mockRun,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns description when found', async () => {
    mockRun.mockResolvedValue({ Product: 'MAT001', ProductDescription: 'Widget A' });
    const result = await svc.getForMaterial('MAT001', 'EN');
    expect(result?.ProductDescription).toBe('Widget A');
  });

  it('returns null when not found', async () => {
    mockRun.mockResolvedValue(null);
    expect(await svc.getForMaterial('MAT999', 'EN')).toBeNull();
  });

  it('propagates exceptions', async () => {
    mockRun.mockRejectedValue(new Error('API down'));
    await expect(svc.getForMaterial('MAT001', 'EN')).rejects.toThrow('API down');
  });
});
```

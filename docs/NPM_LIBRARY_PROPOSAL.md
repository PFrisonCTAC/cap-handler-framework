# NPM Library Proposal - CAP Handler Framework

## 🎯 Goal

Create a reusable npm library that provides a handler framework for SAP CAP projects with support for **multiple services**.

---

## 📦 Proposed Package Name

### Option 1 (Recommended): `@ctac/cap-handler-framework`
- **Pro:** Clear, professional, scoped to organization
- **Con:** None
- **Example usage:** `npm install @ctac/cap-handler-framework`

### Option 2: `cap-entity-handlers`
- **Pro:** Descriptive, SEO-friendly
- **Con:** Not scoped, may have naming conflicts

### Option 3: `@sap-cap/handler-framework`
- **Pro:** Clear SAP CAP association
- **Con:** Requires SAP scope access

**Recommendation:** Use **`@ctac/cap-handler-framework`**

---

## 📁 Proposed Library Structure

### NPM Package Structure

```
@ctac/cap-handler-framework/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
├── .npmignore
├── src/
│   ├── index.ts                          # Main export
│   ├── core/
│   │   ├── BaseHandler.ts                # Base class
│   │   ├── ProxyHandler.ts               # Proxy base
│   │   ├── HandlerRegistry.ts            # Auto-registration
│   │   ├── HandlerContext.ts             # DI context
│   │   └── types.ts                      # Type definitions
│   ├── factories/
│   │   └── HandlerFactory.ts             # Singleton factory
│   ├── utils/
│   │   ├── ExpandTree.ts                 # Expand optimization
│   │   ├── VirtualElementFilter.ts       # Query cleaning
│   │   └── QueryHelper.ts                # CQN helpers
│   └── decorators/                       # Future: decorator support
│       ├── Before.ts
│       ├── On.ts
│       └── After.ts
├── dist/                                 # Compiled JavaScript
│   ├── index.js
│   ├── index.d.ts
│   └── ...
└── test/
    └── ...
```

---

## 🏗️ Consumer Project Structure (Multi-Service)

### Your Kreglinger Project Structure

```
KreglingerOfferteTool/
├── package.json
│   └── dependencies:
│       └── "@ctac/cap-handler-framework": "^1.0.0"
├── srv/
│   ├── opportunity-management/
│   │   ├── opportunity-management-service.ts
│   │   ├── opportunity-management-service.cds
│   │   └── handlers/
│   │       ├── entities/
│   │       │   ├── TradeSlipsHandler.ts
│   │       │   ├── OpportunitiesHandler.ts
│   │       │   └── ...
│   │       ├── proxies/
│   │       │   ├── BusinessPartnersProxyHandler.ts
│   │       │   └── ...
│   │       └── utils/
│   │           └── SequenceManager.ts      # Service-specific util
│   │
│   └── value-help/
│       ├── value-help-service.ts
│       ├── value-help-service.cds
│       └── handlers/
│           ├── entities/
│           │   ├── CountriesHandler.ts
│           │   ├── RegionsHandler.ts
│           │   └── ...
│           └── operations/
│               └── searchValueHelp.ts
```

---

## 💡 Usage Pattern

### 1. Install Library

```bash
npm install @ctac/cap-handler-framework
```

### 2. Service Implementation (Opportunity Management)

```typescript
// srv/opportunity-management/opportunity-management-service.ts
import { registerHandlers } from '@ctac/cap-handler-framework';
import cds from '@sap/cds';

// Import service-specific handlers
import TradeSlipsHandler from './handlers/entities/TradeSlipsHandler';
import OpportunitiesHandler from './handlers/entities/OpportunitiesHandler';
import BusinessPartnersProxyHandler from './handlers/proxies/BusinessPartnersProxyHandler';
import { SequenceManager } from './handlers/utils/SequenceManager';

export default class OpportunityManagementService extends cds.ApplicationService {
  async init() {
    // Register handlers for THIS service
    await registerHandlers(this, {
      handlerClasses: [
        TradeSlipsHandler,
        OpportunitiesHandler,
        BusinessPartnersProxyHandler,
        // ... all handlers for this service
      ],
      externalServices: ['API_BUSINESS_PARTNER', 'API_PRODUCT_SRV'],
      utilities: {
        sequenceManager: new SequenceManager(),
      },
    });

    return super.init();
  }
}
```

### 3. Service Implementation (Value Help)

```typescript
// srv/value-help/value-help-service.ts
import { registerHandlers } from '@ctac/cap-handler-framework';
import cds from '@sap/cds';

// Import service-specific handlers
import CountriesHandler from './handlers/entities/CountriesHandler';
import RegionsHandler from './handlers/entities/RegionsHandler';

export default class ValueHelpService extends cds.ApplicationService {
  async init() {
    // Register handlers for THIS service
    await registerHandlers(this, {
      handlerClasses: [
        CountriesHandler,
        RegionsHandler,
        // ... all handlers for this service
      ],
      externalServices: ['API_COUNTRY_SRV'],
    });

    return super.init();
  }
}
```

### 4. Handler Implementation (Uses Framework)

```typescript
// srv/opportunity-management/handlers/entities/TradeSlipsHandler.ts
import { BaseHandler, TypedRequest } from '@ctac/cap-handler-framework';

export default class TradeSlipsHandler extends BaseHandler {
  getEntityName(): string {
    return 'TradeSlips';
  }

  shouldHandleDrafts(): boolean {
    return true;
  }

  async beforeCreate(req: TypedRequest): Promise<void> {
    // Use framework features
    this.initializeExpandTree(req);
    const sequenceManager = this.getUtility('sequenceManager');
    req.data.tradeSlipIndex = await sequenceManager.nextTradeSlipIndex();
  }

  async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
    this.initializeExpandTree(req);
    const result = await next();
    
    // Only enrich if expanded
    if (this.isExpanded('businessPartner')) {
      await this.enrichBusinessPartner(result);
    }
    
    return result;
  }
}
```

---

## 🔄 Migration Plan

### Phase 1: Extract Core to Library

**Move to npm package:**
```
srv/opportunity-management/handlers/core/*     → @ctac/cap-handler-framework/src/core/
srv/opportunity-management/handlers/factories/* → @ctac/cap-handler-framework/src/factories/
srv/opportunity-management/handlers/utils/ExpandTree.ts → @ctac/cap-handler-framework/src/utils/
srv/opportunity-management/handlers/utils/VirtualElementFilter.ts → @ctac/cap-handler-framework/src/utils/
srv/opportunity-management/handlers/utils/QueryHelper.ts → @ctac/cap-handler-framework/src/utils/
```

**Keep in project:**
```
srv/opportunity-management/handlers/entities/*  (Service-specific)
srv/opportunity-management/handlers/proxies/*   (Service-specific)
srv/opportunity-management/handlers/utils/SequenceManager.ts (Service-specific)
```

### Phase 2: Create Package

```bash
# Create new npm package
mkdir -p ~/cap-handler-framework
cd ~/cap-handler-framework
npm init -y
```

**package.json:**
```json
{
  "name": "@ctac/cap-handler-framework",
  "version": "1.0.0",
  "description": "Handler framework for SAP CAP applications with multi-service support",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "sap",
    "cap",
    "cds",
    "handlers",
    "framework",
    "typescript"
  ],
  "author": "CTAC",
  "license": "MIT",
  "peerDependencies": {
    "@sap/cds": "^7.0.0 || ^8.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### Phase 3: Update Kreglinger Project

**Install library:**
```bash
npm install @ctac/cap-handler-framework
```

**Update imports:**
```typescript
// OLD
import { BaseHandler } from '../core/BaseHandler';
import { TypedRequest } from '../core/types';

// NEW
import { BaseHandler, TypedRequest } from '@ctac/cap-handler-framework';
```

### Phase 4: Add Value Help Service Support

```typescript
// srv/value-help/value-help-service.ts
import { registerHandlers } from '@ctac/cap-handler-framework';
import cds from '@sap/cds';

export default class ValueHelpService extends cds.ApplicationService {
  async init() {
    await registerHandlers(this, {
      handlerClasses: [
        // Your value-help handlers
      ],
    });
    return super.init();
  }
}
```

---

## 📊 Comparison: Current vs Proposed

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Services** | 1 (OpportunityManagement) | Multiple (OpportunityMgmt + ValueHelp) |
| **Reusability** | Project-specific | npm library |
| **Core location** | `srv/opportunity-management/handlers/core/` | `@ctac/cap-handler-framework` |
| **Handler location** | Same folder | Per service: `srv/<service>/handlers/` |
| **Updates** | Manual copy/paste | `npm update` |
| **Versioning** | None | Semantic versioning |
| **Testing** | Project-level | Library + project |
| **Documentation** | Project docs | npm README |

---

## 🎯 Benefits

### For Library Users

✅ **Reusable** across multiple CAP projects  
✅ **Multi-service** support out of the box  
✅ **Semantic versioning** for stability  
✅ **Type-safe** with full TypeScript support  
✅ **Well-tested** library code  
✅ **Documented** with examples  

### For Your Organization

✅ **Standardization** across projects  
✅ **Faster development** (copy framework, not code)  
✅ **Easier maintenance** (update library, not every project)  
✅ **Knowledge sharing** (one framework to learn)  

---

## 📝 Library Exports

**Main export file (`src/index.ts`):**

```typescript
// Core
export { BaseHandler } from './core/BaseHandler';
export { ProxyHandler } from './core/ProxyHandler';
export { registerHandlers } from './core/HandlerRegistry';
export { createHandlerContext, HandlerContextBuilder } from './core/HandlerContext';

// Factories
export { default as HandlerFactory } from './factories/HandlerFactory';

// Utils
export { ExpandTree } from './utils/ExpandTree';
export { VirtualElementFilter } from './utils/VirtualElementFilter';
export { QueryHelper } from './utils/QueryHelper';

// Types
export type {
  HandlerContext,
  TypedRequest,
  ExpandConfig,
  DeepCopyOptions,
  Logger,
  CAPEvent,
  EventPhase,
} from './core/types';

// Future: Decorators
// export { Before, On, After } from './decorators';
```

---

## 🚀 Publish to npmjs

### Step 1: Create npm Account

```bash
npm adduser
```

### Step 2: Publish (Scoped Package)

```bash
# First time
npm publish --access public

# Updates
npm version patch  # 1.0.0 → 1.0.1
npm publish
```

### Step 3: Install in Projects

```bash
npm install @ctac/cap-handler-framework
```

---

## 📖 README for npm Package

````markdown
# @ctac/cap-handler-framework

Handler framework for SAP CAP applications with multi-service support, TypeScript, and advanced features.

## Features

✅ Convention-based handler mapping (`beforeCreate`, `onRead`, etc.)  
✅ Draft entity lifecycle support  
✅ Multi-service architecture  
✅ Dependency injection  
✅ Performance optimizations (ExpandTree, VirtualElementFilter)  
✅ Proxy handler for external services  
✅ Factory pattern for cross-handler communication  
✅ Full TypeScript support  

## Installation

```bash
npm install @ctac/cap-handler-framework
```

## Quick Start

```typescript
import { registerHandlers, BaseHandler } from '@ctac/cap-handler-framework';

class MyEntityHandler extends BaseHandler {
  getEntityName() { return 'MyEntity'; }
  
  async beforeCreate(req) {
    // Your logic
  }
}

export default class MyService extends cds.ApplicationService {
  async init() {
    await registerHandlers(this, {
      handlerClasses: [MyEntityHandler],
    });
    return super.init();
  }
}
```

## Documentation

See [GitHub Repository](https://github.com/ctac/cap-handler-framework) for full documentation.

## License

MIT
````

---

## ✅ Recommended Action Plan

1. **✅ Create npm package** structure
2. **✅ Extract core** files to package
3. **✅ Publish v1.0.0** to npm
4. **✅ Update Kreglinger** to use package
5. **✅ Add ValueHelp** service handlers
6. **✅ Document** usage patterns
7. **✅ Add tests** to library

**Would you like me to start implementing this structure?**

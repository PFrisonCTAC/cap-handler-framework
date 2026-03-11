# cap-handler-framework

Handler framework for SAP CAP applications with multi-service support, TypeScript, and full draft lifecycle.

## ✨ Features

- ✅ **Convention-based** - Auto-maps methods like `beforeCreate`, `onRead`, `afterUpdate`
- ✅ **Multi-service** - Support for unlimited CAP services
- ✅ **Draft lifecycle** - Full support for draft entities (NEW, EDIT, SAVE, CANCEL, etc.)
- ✅ **Type-safe** - Full TypeScript support with type definitions
- ✅ **Performance** - ExpandTree optimization (50-80% fewer calls)
- ✅ **Auto-discovery** - Handlers automatically discovered via cds-plugin
- ✅ **Dependency injection** - Shared context for services and utilities
- ✅ **Factory pattern** - Cross-handler communication support

## 📦 Installation

```bash
npm install cap-handler-framework
```

## 🚀 Quick Start

### 1. Create Handler

```typescript
// srv/my-service/handlers/entities/BooksHandler.ts
import { BaseHandler, TypedRequest } from 'cap-handler-framework';

export default class BooksHandler extends BaseHandler {
  getEntityName() {
    return 'Books';
  }

  async beforeCreate(req: TypedRequest): Promise<void> {
    req.data.createdAt = new Date();
  }

  async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
    this.initializeExpandTree(req);
    const result = await next();
    
    if (this.isExpanded('author')) {
      await this.enrichAuthor(result);
    }
    
    return result;
  }
}
```

### 2. Start Service

```bash
cds watch
```

That's it! Handlers are automatically registered. ✅

## 📖 Documentation

- **[Developer Guide](https://github.com/PFrisonCTAC/cap-handler-framework/blob/main/docs/DEVELOPER_GUIDE.md)** - Complete tutorial and implementation guide
- **[Quick Reference](https://github.com/PFrisonCTAC/cap-handler-framework/blob/main/docs/QUICK_REFERENCE.md)** - Cheat sheet for common patterns
- **[Factory Pattern Usage](https://github.com/PFrisonCTAC/cap-handler-framework/blob/main/docs/FACTORY_PATTERN_USAGE.md)** - Cross-handler communication guide
- **[Framework Comparison](https://github.com/PFrisonCTAC/cap-handler-framework/blob/main/docs/HANDLER_FRAMEWORK_COMPARISON.md)** - Comparison with other handler patterns

## 🎯 Convention-Based Method Mapping

| CDS Event | Handler Method |
|-----------|----------------|
| `before('CREATE')` | `beforeCreate(req)` |
| `on('READ')` | `onRead(req, next)` |
| `after('UPDATE')` | `afterUpdate(data, req)` |
| `before('DELETE')` | `beforeDelete(req)` |

## 🎨 Draft Support

```typescript
export default class OrdersHandler extends BaseHandler {
  shouldHandleDrafts() {
    return true;
  }

  async beforeSaveDraft(req: TypedRequest): Promise<void> {
    // Validate before activation
    if (!req.data.customer_ID) {
      req.error(400, 'Customer is required');
    }
  }

  async afterPatchDraft(data: any, req: TypedRequest): Promise<void> {
    // Auto-compute on field change
    data.total = data.quantity * data.unitPrice;
  }
}
```

## ⚡ Bound Actions

```typescript
async onBorrow(req: TypedRequest): Promise<any> {
  const { ID } = req.params[0];  // Entity key
  const { days } = req.data;      // Parameters
  
  // Your logic
  
  return updatedEntity;
}
```

## 🔌 External Services

```json
// srv/my-service/handlers.config.json
{
  "externalServices": ["API_BUSINESS_PARTNER"]
}
```

```typescript
const bpApi = this.getExternalService('API_BUSINESS_PARTNER');
const result = await bpApi.run(SELECT.from('A_BusinessPartner').where(...));
```

## 🏭 Cross-Handler Communication

```typescript
import { HandlerFactory } from 'cap-handler-framework';

const factory = HandlerFactory.getInstance();
const otherHandler = factory.getTradeSlipsHandler();
await otherHandler.somePublicMethod(data);
```

## 📁 Project Structure

```
srv/
└── my-service/
    ├── my-service.cds
    ├── handlers.config.json (optional)
    └── handlers/
        ├── entities/
        │   └── BooksHandler.ts
        ├── proxies/
        │   └── ExternalServiceProxy.ts
        └── operations/
            └── customAction.ts
```

## 🎓 Learning Resources

1. Start with **Quick Reference** (10 min)
2. Follow **Developer Guide** tutorial (30 min)
3. Explore example handlers in the repo

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines first.

## 🐛 Issues

Found a bug? [Report it here](https://github.com/PFrisonCTAC/cap-handler-framework/issues)

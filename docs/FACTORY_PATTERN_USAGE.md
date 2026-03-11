# Factory Pattern Usage Guide

## 🏭 HandlerFactory - Herbruikbare Handlers

Gebaseerd op het Elia CO2 factory pattern, kun je nu handlers hergebruiken binnen andere handlers.

---

## 📖 Basis Gebruik

### 1. Handler Factory Ophalen

```typescript
import HandlerFactory from '../factories/HandlerFactory';

// In een handler method
const factory = HandlerFactory.getInstance();
```

### 2. Andere Handler Gebruiken

```typescript
// Get een specifieke handler
const tradeSlipsHandler = factory.getTradeSlipsHandler();
const businessPartnersHandler = factory.getBusinessPartnersHandler();

// Gebruik de handler's public methods
const businessLogicResult = await tradeSlipsHandler.somePublicMethod(data);
```

---

## 💡 Voorbeeld: Handler Gebruikt Andere Handler

### Scenario: OpportunitiesHandler heeft TradeSlips logica nodig

```typescript
/**
 * OpportunitiesHandler.ts
 */
import { BaseHandler } from '../core/BaseHandler';
import HandlerFactory from '../factories/HandlerFactory';
import type { TypedRequest } from '../core/types';

export default class OpportunitiesHandler extends BaseHandler {
  getEntityName(): string {
    return 'Opportunities';
  }

  /**
   * Custom action: Convert Opportunity to TradeSlip
   */
  async onConvertToTradeSlip(req: TypedRequest): Promise<any> {
    const opportunityData = req.data;
    
    // Get TradeSlipsHandler via factory
    const factory = HandlerFactory.getInstance();
    const tradeSlipsHandler = factory.getTradeSlipsHandler();
    
    // Use TradeSlipsHandler's business logic
    const tradeSlip = await tradeSlipsHandler.createFromOpportunity(
      opportunityData,
      req.user.id
    );
    
    this.logger.info(`Created TradeSlip ${tradeSlip.ID} from Opportunity ${opportunityData.ID}`);
    
    return tradeSlip;
  }
  
  /**
   * Enrich with data from BusinessPartners
   */
  async onRead(req: TypedRequest, next: () => Promise<any>): Promise<any> {
    const result = await next();
    const rows = this.toArray(result);
    
    if (rows.length === 0) return result;
    
    // Get BusinessPartnersHandler for data lookup
    const factory = HandlerFactory.getInstance();
    const bpHandler = factory.getBusinessPartnersHandler();
    
    // Use BP handler to fetch related data
    for (const row of rows) {
      if (row.prospect) {
        const bpData = await bpHandler.getBusinessPartnerDetails(row.prospect);
        row.prospectDetails = bpData;
      }
    }
    
    return this.formatResponse(rows, req);
  }
}
```

### TradeSlipsHandler met Herbruikbare Methods

```typescript
/**
 * TradeSlipsHandler.ts
 */
import { BaseHandler } from '../core/BaseHandler';
import type { TypedRequest } from '../core/types';

export default class TradeSlipsHandler extends BaseHandler {
  getEntityName(): string {
    return 'TradeSlips';
  }

  // ... existing handlers ...

  /**
   * PUBLIC METHOD - can be called by other handlers via factory
   * Creates a TradeSlip from Opportunity data
   */
  public async createFromOpportunity(
    opportunityData: any,
    userId: string
  ): Promise<any> {
    this.logger.info('Creating TradeSlip from Opportunity');
    
    const tradeSlipData = {
      customerNumber: opportunityData.prospect,
      description: `Created from Opportunity ${opportunityData.ID}`,
      createdBy: userId,
      // ... map other fields
    };
    
    // Use internal sequence manager
    const sequenceManager = this.getUtility('sequenceManager');
    tradeSlipData.tradeSlipIndex = await sequenceManager.getNextTradeSlipIndex();
    
    // Create in database
    const result = await this.db.run(
      INSERT.into('TradeSlips').entries(tradeSlipData)
    );
    
    return result;
  }

  /**
   * PUBLIC METHOD - validate TradeSlip data
   */
  public validateTradeSlipData(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!data.customerNumber) errors.push('Customer number is required');
    if (!data.description) errors.push('Description is required');
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
```

---

## 🔄 Cross-Handler Communication Patterns

### Pattern 1: Data Transformation

```typescript
// In Handler A
const factory = HandlerFactory.getInstance();
const handlerB = factory.getSomeOtherHandler();

// Transform data using Handler B's logic
const transformedData = await handlerB.transformData(inputData);
```

### Pattern 2: Validation

```typescript
// In Handler A
const factory = HandlerFactory.getInstance();
const validator = factory.getValidationHandler();

// Validate using shared validation logic
const { valid, errors } = validator.validateSomething(data);
if (!valid) {
  req.error(400, errors.join(', '));
  return;
}
```

### Pattern 3: Business Logic Delegation

```typescript
// In Handler A
const factory = HandlerFactory.getInstance();
const complexHandler = factory.getComplexBusinessLogicHandler();

// Delegate complex calculation
const result = await complexHandler.calculateComplexStuff(params);
```

### Pattern 4: External Service Access

```typescript
// In Handler A
const factory = HandlerFactory.getInstance();
const bpProxyHandler = factory.getBusinessPartnersHandler();

// Use proxy handler to fetch external data
const businessPartner = await bpProxyHandler.fetchByID(bpId);
```

---

## 🎯 Best Practices

### ✅ DO

1. **Use Factory voor herbruikbare logica**
   ```typescript
   const factory = HandlerFactory.getInstance();
   const handler = factory.getTradeSlipsHandler();
   await handler.somePublicMethod(data);
   ```

2. **Maak public methods voor herbruikbare functionaliteit**
   ```typescript
   export default class MyHandler extends BaseHandler {
     // PUBLIC - can be called via factory
     public async doSomething(data: any): Promise<any> {
       // ...
     }
     
     // PROTECTED - only for internal/child class use
     protected helperMethod() {
       // ...
     }
   }
   ```

3. **Documenteer public methods duidelijk**
   ```typescript
   /**
    * PUBLIC API - Creates TradeSlip from external data
    * 
    * @param data - External data source
    * @param userId - User creating the record
    * @returns Created TradeSlip
    */
   public async createFromExternal(data: any, userId: string): Promise<any>
   ```

### ❌ DON'T

1. **Geen circulaire dependencies**
   ```typescript
   // BAD: Handler A calls Handler B, Handler B calls Handler A
   // This creates infinite loops
   ```

2. **Niet alle logica via factory**
   ```typescript
   // BAD: Simple helpers don't need factory
   const factory = HandlerFactory.getInstance();
   const handler = factory.getUtilHandler();
   const result = handler.add(1, 2); // Overkill!
   
   // GOOD: Use utility functions for simple logic
   import { add } from '../utils/math';
   const result = add(1, 2);
   ```

3. **Niet private methods via factory aanroepen**
   ```typescript
   // BAD: Can't access private methods anyway
   const handler = factory.getHandler();
   handler.privateMethod(); // TypeScript error
   ```

---

## 🧪 Testing met Factory

```typescript
import HandlerFactory from '../factories/HandlerFactory';
import { createHandlerContext } from '../core/HandlerContext';

describe('OpportunitiesHandler', () => {
  let factory: HandlerFactory;
  let context: HandlerContext;
  
  beforeEach(async () => {
    // Create test context
    context = createHandlerContext(mockService)
      .withDatabase()
      .build();
    
    // Initialize factory
    factory = HandlerFactory.getInstance();
    factory.initialize(context);
  });
  
  afterEach(() => {
    // Clear factory cache for next test
    factory.clearCache();
  });
  
  it('should convert opportunity to trade slip', async () => {
    const handler = factory.getOpportunitiesHandler();
    const result = await handler.onConvertToTradeSlip(mockRequest);
    
    expect(result).toBeDefined();
    expect(result.ID).toBeDefined();
  });
});
```

---

## 📊 Factory vs Direct Import

| Aspect | Factory Pattern | Direct Import |
|--------|----------------|---------------|
| **Gebruik** | Cross-handler communication | Internal helpers |
| **Instantiation** | Singleton, lazy-loaded | New instance per use |
| **Context Sharing** | Shared HandlerContext | No shared context |
| **Testing** | Easy to mock | Harder to mock |
| **Circular Deps** | Possible, be careful | TypeScript prevents |
| **Performance** | Cached instances | New instance each time |

---

## 🚀 Volledige Voorbeeld

```typescript
/**
 * ComplexWorkflowHandler.ts - Orchestrates multiple handlers
 */
import { BaseHandler } from '../core/BaseHandler';
import HandlerFactory from '../factories/HandlerFactory';
import type { TypedRequest } from '../core/types';

export default class ComplexWorkflowHandler extends BaseHandler {
  getEntityName(): string {
    return 'ComplexWorkflows';
  }

  /**
   * Execute complex multi-step workflow
   */
  async onExecuteWorkflow(req: TypedRequest): Promise<any> {
    const factory = HandlerFactory.getInstance();
    const workflowData = req.data;
    
    try {
      // Step 1: Validate with OpportunitiesHandler
      const oppHandler = factory.getOpportunitiesHandler();
      const validation = await oppHandler.validateOpportunity(workflowData.opportunityId);
      
      if (!validation.valid) {
        return req.error(400, `Validation failed: ${validation.errors.join(', ')}`);
      }
      
      // Step 2: Create TradeSlip via TradeSlipsHandler
      const tsHandler = factory.getTradeSlipsHandler();
      const tradeSlip = await tsHandler.createFromOpportunity(
        workflowData.opportunity,
        req.user.id
      );
      
      // Step 3: Fetch BusinessPartner details via ProxyHandler
      const bpHandler = factory.getBusinessPartnersHandler();
      const bpDetails = await bpHandler.getBusinessPartnerDetails(
        tradeSlip.customerNumber
      );
      
      // Step 4: Enrich TradeSlip with BP data
      await tsHandler.enrichWithBusinessPartnerData(tradeSlip.ID, bpDetails);
      
      // Step 5: Create child items
      const itemHandler = factory.getTradeSlipItemHandler();
      for (const itemData of workflowData.items) {
        await itemHandler.createItem(tradeSlip.ID, itemData);
      }
      
      this.logger.info(`Workflow completed: TradeSlip ${tradeSlip.ID} created`);
      
      return {
        success: true,
        tradeSlipId: tradeSlip.ID,
        itemCount: workflowData.items.length,
      };
      
    } catch (error) {
      this.logger.error('Workflow execution failed:', error);
      throw error;
    }
  }
}
```

---

## 📝 Samenvatting

**HandlerFactory voordelen:**
✅ Herbruikbare business logic  
✅ Shared context tussen handlers  
✅ Singleton pattern (lazy loaded)  
✅ Type-safe handler access  
✅ Easy testing met mocking  
✅ Centralized handler management  

**Wanneer gebruiken:**
- Cross-handler communication nodig
- Gedeelde business logic
- Complex workflows met multiple handlers
- Testing scenarios

**Wanneer NIET gebruiken:**
- Eenvoudige utility functions
- Internal helper methods
- Circulaire dependencies
- Simple calculations

De factory is klaar voor gebruik! 🎉

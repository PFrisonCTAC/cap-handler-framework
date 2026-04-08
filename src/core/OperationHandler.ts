/**
 * @module cap-handler-framework
 * OperationHandler — base class for service-level (unbound) actions and functions.
 *
 * Use this class when you need to implement an **unbound action or function**
 * defined at service level in CDS — i.e., declared directly inside the
 * `service { }` block, NOT inside an entity's `actions { }` block.
 *
 * Key differences from `BaseHandler`:
 * - `getEntityName()` returns `null` — no CDS entity is required.
 * - `shouldHandleDrafts()` returns `false` — drafts are entity-centric.
 * - Only `onUnboundAction_*` and `onUnboundFunction_*` method conventions work.
 * - The handler is keyed by its **class name** in the registry (not entity name),
 *   so multiple operation handlers can coexist.
 *
 * ## Handler naming conventions
 *
 * | Method prefix            | CDS declaration         | CAP registration                  |
 * |--------------------------|-------------------------|-----------------------------------|
 * | `onUnboundAction_<Name>` | `action <Name>(...)`    | `srv.on('<Name>', handler)`        |
 * | `onUnboundFunction_<N>`  | `function <Name>(...)`  | `srv.on('<Name>', handler)`        |
 *
 * ## Example — CDS
 *
 * ```cds
 * service MyService {
 *   action CreateWithReference(quote_ID: String) returns TradeSlips;
 *   function GetStatistics() returns Statistics;
 * }
 * ```
 *
 * ## Example — Handler
 *
 * ```typescript
 * import { OperationHandler, TypedRequest } from 'cap-handler-framework';
 *
 * export default class CreateWithReferenceHandler extends OperationHandler {
 *   /**
 *    * Handles: action CreateWithReference(quote_ID: String) returns TradeSlips;
 *    * Registered as: srv.on('CreateWithReference', handler)
 *    *\/
 *   async onUnboundAction_CreateWithReference(req: TypedRequest): Promise<any> {
 *     const { quote_ID } = req.data;
 *     // ... implementation
 *   }
 * }
 * ```
 *
 * ## Folder convention
 *
 * Place operation handlers in `handlers/operations/`:
 * ```
 * handlers/
 * ├── entities/          ← entity handlers (BaseHandler subclasses)
 * ├── operations/        ← unbound action/function handlers (OperationHandler subclasses)
 * ├── proxies/           ← proxy handlers (ProxyHandler subclasses)
 * └── index.ts           ← HANDLER_CLASSES must include operation handlers
 * ```
 *
 * ## Registration
 *
 * Operation handlers MUST be included in `HANDLER_CLASSES` in your `handlers/index.ts`:
 *
 * ```typescript
 * import CreateWithReferenceHandler from './operations/CreateWithReferenceHandler';
 *
 * export const HANDLER_CLASSES = [
 *   // ... entity handlers
 *   CreateWithReferenceHandler,   // ← operation handler
 *   // ... proxy handlers
 * ];
 * ```
 */

import { BaseHandler } from './BaseHandler';

/**
 * Abstract base class for service-level (unbound) action and function handlers.
 *
 * Extend this instead of `BaseHandler` when implementing an action or function
 * that is declared at the service level in CDS (not bound to an entity).
 */
export abstract class OperationHandler extends BaseHandler {
  /**
   * Operation handlers are not bound to any CDS entity.
   * The registry uses the class name as the handler key.
   */
  override getEntityName(): string | null {
    return null;
  }

  /**
   * Operation handlers never interact with draft entities.
   */
  override shouldHandleDrafts(): boolean {
    return false;
  }
}

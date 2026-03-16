/**
 * @module @kreglinger/cds-handler-framework
 * Handler Registry - Auto-discovery and registration of handlers
 * 
 * Lifecycle hook naming conventions:
 * 
 * ACTIVE ENTITY HOOKS (register on active entity):
 *   beforeCreate, afterCreate
 *   beforeRead, onRead, afterRead
 *   beforeUpdate, afterUpdate
 *   beforeDelete, afterDelete
 *
 * DRAFT LIFECYCLE HOOKS (register on entity.drafts or entity for EDIT/NEW):
 *   beforeCreateDraft, afterCreateDraft   → entity.drafts CREATE (fires during NEW)
 *   beforePatchDraft, afterPatchDraft     → entity.drafts PATCH
 *   beforeNewDraft, afterNewDraft         → entity NEW (before/after draft creation starts)
 *   beforeEditDraft, afterEditDraft       → entity EDIT (before/after edit-draft creation)
 *   beforeSaveDraft, afterSaveDraft       → entity.drafts SAVE (before/after activation)
 *   beforeDiscardDraft, afterDiscardDraft → entity.drafts CANCEL (discard draft)
 *
 * ACTION / FUNCTION HOOKS:
 *   onBoundAction_<ActionName>            → srv.on('<ActionName>', entity, handler)
 *   onUnboundAction_<ActionName>          → srv.on('<ActionName>', handler)
 *   onBoundFunction_<FunctionName>        → srv.on('<FunctionName>', entity, handler)
 *   onUnboundFunction_<FunctionName>      → srv.on('<FunctionName>', handler)
 *
 *   Legacy (auto-detected from service model, backward compat):
 *   on<ActionName>                        → auto-matched against entity/service actions
 *
 * SPECIAL CASES:
 *   afterRead with shouldHandleDrafts()=true → registers on [entity, entity.drafts]
 *     so draft list/detail views also trigger the hook.
 *   All other no-suffix methods with shouldHandleDrafts()=true → active entity only.
 */

import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { ApplicationService } from '@sap/cds';
import type {
  HandlerContext,
  HandlerMetadata,
  EventRegistration,
  CAPEvent,
  EventPhase,
  ParsedMethodName,
} from './types';
import { BaseHandler } from './BaseHandler';
import { createHandlerContext } from './HandlerContext';

/**
 * Method name to CAP event mapping (lowercase key → CAPEvent)
 */
const METHOD_TO_EVENT_MAP: Record<string, CAPEvent> = {
  create: 'CREATE',
  read: 'READ',
  update: 'UPDATE',
  patch: 'PATCH',
  delete: 'DELETE',
  new: 'NEW',
  edit: 'EDIT',
  save: 'SAVE',
  cancel: 'CANCEL',
  discard: 'DISCARD',
};

/**
 * Draft-suffixed events that belong on the ACTIVE entity (not entity.drafts).
 *
 * CAP fires NEW and EDIT on the active entity, even though they initiate
 * draft creation. Registering these on entity.drafts would be wrong.
 */
const ACTIVE_ENTITY_DRAFT_EVENTS = new Set<string>(['NEW', 'EDIT']);

/**
 * Standard READ events — afterRead registers on both active + drafts
 * when shouldHandleDrafts()=true, so draft list/detail views are also enriched.
 */
const READ_EVENTS = new Set<string>(['READ']);

// ────────────────────────────────────────────────────────────────────────────
// HandlerRegistry
// ────────────────────────────────────────────────────────────────────────────

/**
 * Handler Registry — manages handler discovery, parsing, and CAP registration.
 */
export class HandlerRegistry {
  private context: HandlerContext;
  private handlers: Map<string, HandlerMetadata> = new Map();
  private handlerDirectory: string;

  constructor(context: HandlerContext) {
    this.context = context;
    this.handlerDirectory = context.config.handlerDirectory || './handlers';
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Discover and register all handlers found recursively in `baseDir/handlers/`.
   */
  async registerAll(baseDir: string): Promise<void> {
    const handlersDir = join(baseDir, this.handlerDirectory);
    this.context.logger.info(`Discovering handlers in: ${handlersDir}`);

    try {
      await this.discoverHandlers(handlersDir);
      await this.registerHandlers();
      this.context.logger.info(`Registered ${this.handlers.size} handler(s)`);
    } catch (error) {
      this.context.logger.error('Failed to register handlers:', error);
      throw error;
    }
  }

  /**
   * Register handlers from an explicit class list (preferred — avoids TS import issues).
   *
   * @example
   * ```typescript
   * import { HANDLER_CLASSES } from './handlers';
   * await registry.registerFromClasses(HANDLER_CLASSES);
   * ```
   */
  async registerFromClasses(handlerClasses: any[]): Promise<void> {
    this.context.logger.info(`Registering ${handlerClasses.length} handler class(es)...`);

    for (const HandlerClass of handlerClasses) {
      try {
        if (!(HandlerClass.prototype instanceof BaseHandler)) {
          this.context.logger.warn(`Handler class does not extend BaseHandler — skipped`);
          continue;
        }

        const handlerInstance = new HandlerClass(this.context);
        const entityName = handlerInstance.getEntityName();

        if (!entityName) {
          this.context.logger.warn(`Handler has no entity name — skipped`);
          continue;
        }

        const metadata: HandlerMetadata = {
          entityName,
          handlesDrafts: handlerInstance.shouldHandleDrafts(),
          registrations: [],
          instance: handlerInstance,
        };

        this.handlers.set(entityName, metadata);
        this.context.logger.debug(`Loaded handler for entity: ${entityName}`);
      } catch (error) {
        this.context.logger.error(`Failed to load handler class:`, error);
      }
    }

    await this.registerHandlers();
    this.context.logger.info(`Successfully registered ${this.handlers.size} handler(s)`);
  }

  /** Get handler metadata by entity name. */
  getHandler(entityName: string): HandlerMetadata | undefined {
    return this.handlers.get(entityName);
  }

  /** Get all registered handlers. */
  getAllHandlers(): HandlerMetadata[] {
    return Array.from(this.handlers.values());
  }

  /** Destroy all handlers (cleanup). */
  async destroyAll(): Promise<void> {
    for (const metadata of this.handlers.values()) {
      try {
        await metadata.instance.onDestroy();
      } catch (error) {
        this.context.logger.error(
          `Error destroying handler for ${metadata.entityName}:`,
          error
        );
      }
    }
    this.handlers.clear();
  }

  // ── File discovery ─────────────────────────────────────────────────────────

  private async discoverHandlers(directory: string): Promise<void> {
    try {
      const entries = readdirSync(directory);

      for (const entry of entries) {
        const fullPath = join(directory, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          if (entry === 'core' || entry === 'utils') continue;
          await this.discoverHandlers(fullPath);
        } else if (stat.isFile()) {
          const ext = extname(entry);
          if ((ext === '.ts' || ext === '.js') && entry.endsWith('Handler' + ext)) {
            await this.loadHandler(fullPath);
          }
        }
      }
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        this.context.logger.warn(`Handler directory not found: ${directory}`);
      } else {
        throw error;
      }
    }
  }

  private async loadHandler(filePath: string): Promise<void> {
    try {
      const ext = extname(filePath);
      const pathWithoutExt = filePath.substring(0, filePath.length - ext.length);
      const importPath = pathWithoutExt.startsWith('/')
        ? `file://${pathWithoutExt}${ext}`
        : pathWithoutExt;

      this.context.logger.debug(`Loading handler from: ${importPath}`);
      const handlerModule = await import(importPath);
      const HandlerClass = handlerModule.default;

      if (!HandlerClass) {
        this.context.logger.warn(`No default export in ${filePath}`);
        return;
      }
      if (!(HandlerClass.prototype instanceof BaseHandler)) {
        this.context.logger.warn(`${filePath} does not extend BaseHandler`);
        return;
      }

      const handlerInstance = new HandlerClass(this.context);
      const entityName = handlerInstance.getEntityName();

      if (!entityName) {
        this.context.logger.warn(`Handler in ${filePath} has no entity name`);
        return;
      }

      const metadata: HandlerMetadata = {
        entityName,
        handlesDrafts: handlerInstance.shouldHandleDrafts(),
        registrations: [],
        instance: handlerInstance,
      };

      this.handlers.set(entityName, metadata);
      this.context.logger.info(`Loaded handler for ${entityName}`);
    } catch (error) {
      this.context.logger.error(`Failed to load handler from ${filePath}:`, error);
    }
  }

  // ── Handler registration ───────────────────────────────────────────────────

  private async registerHandlers(): Promise<void> {
    for (const [, metadata] of this.handlers) {
      await this.registerHandler(metadata);
    }
  }

  private async registerHandler(metadata: HandlerMetadata): Promise<void> {
    const { instance, entityName } = metadata;
    const entity = this.context.srv.entities[entityName];

    if (!entity) {
      this.context.logger.warn(
        `Entity '${entityName}' not found in service — handler will not be registered. ` +
        `Check that getEntityName() returns the exact entity name as defined in the CDS service.`
      );
      return;
    }

    instance.entity = entity;

    this.registerConventionBasedMethods(metadata, entity);

    await instance.onInit();

    this.context.logger.info(
      `Registered ${metadata.registrations.length} event(s) for ${entityName}`
    );
  }

  // ── Method discovery & parsing ─────────────────────────────────────────────

  /**
   * Walk the prototype chain and register all convention-matching methods.
   */
  private registerConventionBasedMethods(metadata: HandlerMetadata, entity: any): void {
    const { instance, entityName, handlesDrafts } = metadata;

    // Collect all methods from the instance and its prototype chain
    const methods = new Set<string>();
    let proto = Object.getPrototypeOf(instance);
    while (proto && proto !== Object.prototype) {
      for (const m of Object.getOwnPropertyNames(proto)) {
        methods.add(m);
      }
      proto = Object.getPrototypeOf(proto);
    }

    for (const methodName of methods) {
      // Skip lifecycle/infrastructure methods
      if (
        methodName === 'constructor' ||
        methodName === 'onInit' ||
        methodName === 'onDestroy' ||
        methodName === 'getEntityName' ||
        methodName === 'shouldHandleDrafts'
      ) {
        continue;
      }

      const method = instance[methodName];
      if (typeof method !== 'function') continue;

      const parsed = this.parseMethodName(methodName, entity);
      if (!parsed) continue;

      const { phase, event, isDraftSpecific, isActiveOnly } = parsed;
      const boundHandler = method.bind(instance);

      // ── Unbound operations (service-level, no entity) ──────────────────────
      if (parsed.isUnboundAction || parsed.isUnboundFunction) {
        this.context.srv.on(event, boundHandler);
        metadata.registrations.push({
          phase: 'on',
          event,
          methodName,
          entities: [],
          isUnboundAction: parsed.isUnboundAction,
          isUnboundFunction: parsed.isUnboundFunction,
        });
        this.context.logger.debug(
          `Registered srv.on('${event}') [unbound] → ${entityName}.${methodName}`
        );
        continue;
      }

      // ── Bound operations (entity-level, always 'on' phase) ─────────────────
      if (parsed.isBoundAction || parsed.isBoundFunction) {
        // For draft-enabled entities, bound actions/functions must also be
        // registered on entity.drafts. When the user triggers a bound action
        // while a draft is open (IsActiveEntity=false), CAP dispatches the
        // request against <Entity>.drafts — not the active entity.
        //
        // We register with STRING entity names (not object references) because
        // that is the most reliable form for srv.on() in all CAP versions.
        // String registration avoids potential reference-equality issues with
        // draft companion entities.
        const targetNames: string[] = [entityName];
        if (handlesDrafts) {
          const draftEntityName = `${entityName}.drafts`;
          // Confirm the draft entity actually exists before registering
          const draftExists =
            entity.drafts != null ||
            this.context.srv.entities[draftEntityName] != null;
          if (draftExists) {
            targetNames.push(draftEntityName);
          } else {
            this.context.logger.warn(
              `Handler '${entityName}' declares shouldHandleDrafts()=true but ` +
              `'${draftEntityName}' was not found in the service. ` +
              `Is the entity annotated with @odata.draft.enabled?`
            );
          }
        }

        for (const targetName of targetNames) {
          this.context.srv.on(event, targetName as any, boundHandler);
        }

        metadata.registrations.push({
          phase: 'on',
          event,
          methodName,
          entities: targetNames.map(
            (n) => this.context.srv.entities[n] ?? { name: n }
          ),
          isBoundAction: parsed.isBoundAction,
          isBoundFunction: parsed.isBoundFunction,
        });
        this.context.logger.info(
          `Registered srv.on('${event}') [bound] on [${targetNames.join(', ')}] → ${entityName}.${methodName}`
        );
        continue;
      }

      // ── Standard lifecycle events ──────────────────────────────────────────
      const entities = this.resolveTargetEntities(
        event,
        entity,
        isDraftSpecific,
        isActiveOnly,
        handlesDrafts
      );

      if (entities.length === 0) {
        this.context.logger.warn(
          `No target entities for method '${methodName}' on '${entityName}'. ` +
          `entity.drafts may not exist (is the entity annotated with @odata.draft.enabled?)`
        );
        continue;
      }

      this.registerEventHandler(phase, event, entities, instance, methodName, metadata);
    }
  }

  /**
   * Determine which entity targets to register on based on the event and modifiers.
   *
   * Rules:
   *  1. `Draft`-suffixed + EDIT/NEW event → active entity (EDIT/NEW fire on active entity)
   *  2. `Draft`-suffixed + other event    → entity.drafts
   *  3. `Active`-suffixed                 → active entity only
   *  4. READ event + shouldHandleDrafts=true → [entity, entity.drafts]  (enrich both views)
   *  5. All other no-suffix methods       → active entity only
   *     (CRITICAL FIX: was previously [entity, entity.drafts] when shouldHandleDrafts=true,
   *      causing beforeCreate to fire during draft-table INSERT triggered by NEW event)
   */
  private resolveTargetEntities(
    event: string,
    entity: any,
    isDraftSpecific: boolean | undefined,
    isActiveOnly: boolean | undefined,
    handlesDrafts: boolean
  ): any[] {
    if (isDraftSpecific) {
      // EDIT and NEW are fired on the active entity even in draft workflows
      if (ACTIVE_ENTITY_DRAFT_EVENTS.has(event)) {
        return [entity];
      }
      // All other draft-suffixed methods → drafts table
      return entity.drafts ? [entity.drafts] : [];
    }

    if (isActiveOnly) {
      return [entity];
    }

    // READ events on draft-enabled handlers → register on both active + drafts
    // so that afterRead fires for both the active list and the draft detail page
    if (handlesDrafts && READ_EVENTS.has(event)) {
      return [entity, entity.drafts].filter(Boolean);
    }

    // Default: active entity only
    // (This was the source of the beforeCreate double-firing bug)
    return [entity];
  }

  // ── Method name parsing ────────────────────────────────────────────────────

  /**
   * Parse a handler method name to extract the lifecycle phase, CAP event,
   * and any modifiers (Draft, Active) or operation type (BoundAction, etc.).
   *
   * Naming conventions parsed:
   *
   *   Standard lifecycle:
   *     before<Event>[Draft|Active]   e.g. beforeCreate, beforePatchDraft
   *     after<Event>[Draft|Active]    e.g. afterRead, afterSaveDraft
   *     on<Event>[Draft|Active]       e.g. onRead
   *
   *   Explicit action/function hooks (preferred):
   *     onBoundAction_<Name>          e.g. onBoundAction_DuplicateTradeSlip
   *     onUnboundAction_<Name>        e.g. onUnboundAction_CreateWithReference
   *     onBoundFunction_<Name>        e.g. onBoundFunction_GetTotal
   *     onUnboundFunction_<Name>      e.g. onUnboundFunction_GetStats
   *
   *   Legacy action detection (backward compatible):
   *     on<ActionName>  where ActionName is found in entity.actions or srv.actions
   *
   * @param methodName - The method name to parse
   * @param entity     - The CDS entity definition (used for legacy action detection)
   */
  private parseMethodName(methodName: string, entity?: any): ParsedMethodName | null {
    // ── Explicit action/function prefix patterns ───────────────────────────
    if (methodName.startsWith('onBoundAction_')) {
      const event = methodName.substring('onBoundAction_'.length);
      return event ? { phase: 'on', event, isBoundAction: true } : null;
    }
    if (methodName.startsWith('onUnboundAction_')) {
      const event = methodName.substring('onUnboundAction_'.length);
      return event ? { phase: 'on', event, isUnboundAction: true } : null;
    }
    if (methodName.startsWith('onBoundFunction_')) {
      const event = methodName.substring('onBoundFunction_'.length);
      return event ? { phase: 'on', event, isBoundFunction: true } : null;
    }
    if (methodName.startsWith('onUnboundFunction_')) {
      const event = methodName.substring('onUnboundFunction_'.length);
      return event ? { phase: 'on', event, isUnboundFunction: true } : null;
    }

    // ── Standard phase prefix ──────────────────────────────────────────────
    let phase: EventPhase;
    let remainder: string;

    if (methodName.startsWith('before')) {
      phase = 'before';
      remainder = methodName.substring(6);
    } else if (methodName.startsWith('after')) {
      phase = 'after';
      remainder = methodName.substring(5);
    } else if (methodName.startsWith('on')) {
      phase = 'on';
      remainder = methodName.substring(2);
    } else {
      return null;
    }

    if (!remainder) return null;

    // ── Draft / Active modifiers ───────────────────────────────────────────
    let isDraftSpecific = false;
    let isActiveOnly = false;

    if (remainder.endsWith('Draft')) {
      isDraftSpecific = true;
      remainder = remainder.substring(0, remainder.length - 5);
    } else if (remainder.endsWith('Active')) {
      isActiveOnly = true;
      remainder = remainder.substring(0, remainder.length - 6);
    }

    if (!remainder) return null;

    // ── Map to CAP event ───────────────────────────────────────────────────
    const eventKey = remainder.toLowerCase();
    const event = METHOD_TO_EVENT_MAP[eventKey];

    if (event) {
      return { phase, event, isDraftSpecific, isActiveOnly };
    }

    // ── Legacy action/function auto-detection (backward compat) ───────────
    // If on<Name> doesn't match a standard event, check if <Name> is a known
    // action or function in the CDS model.
    if (phase === 'on' && !isDraftSpecific && !isActiveOnly) {
      const candidateName = remainder; // e.g. "DuplicateTradeSlip"

      // Check entity-level bound actions/functions first
      const entityActions = entity?.actions ?? {};
      const entityOps = entity?.elements ?? {};

      if (entityActions[candidateName] != null) {
        this.context.logger.debug(
          `Legacy action detected: '${methodName}' matched entity action '${candidateName}'. ` +
          `Consider renaming to 'onBoundAction_${candidateName}' for clarity.`
        );
        return { phase: 'on', event: candidateName, isBoundAction: true };
      }

      // Check service-level unbound actions/functions
      const srv = this.context.srv as any;
      const srvActions = srv.actions ?? srv.operations ?? {};
      if (srvActions[candidateName] != null) {
        this.context.logger.debug(
          `Legacy action detected: '${methodName}' matched service action '${candidateName}'. ` +
          `Consider renaming to 'onUnboundAction_${candidateName}' for clarity.`
        );
        return { phase: 'on', event: candidateName, isUnboundAction: true };
      }
    }

    return null;
  }

  // ── CAP registration ───────────────────────────────────────────────────────

  private registerEventHandler(
    phase: EventPhase,
    event: CAPEvent | string,
    entities: any[],
    instance: any,
    methodName: string,
    metadata: HandlerMetadata
  ): void {
    const srv = this.context.srv;

    metadata.registrations.push({ phase, event, methodName, entities });

    const boundHandler = instance[methodName].bind(instance);

    switch (phase) {
      case 'before':
        srv.before(event, entities as any, boundHandler);
        break;
      case 'on':
        srv.on(event, entities as any, boundHandler);
        break;
      case 'after':
        srv.after(event, entities as any, boundHandler);
        break;
    }

    const entityNames = entities
      .map((e) => e?.name || e?.drafts?.name || 'unknown')
      .join(', ');
    this.context.logger.debug(
      `Registered ${phase}('${event}') on [${entityNames}] → ${metadata.entityName}.${methodName}`
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// registerHandlers helper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convenience function to set up the handler registry for a CAP service.
 *
 * @example
 * ```typescript
 * export class OpportunityManagementService extends ApplicationService {
 *   async init() {
 *     await registerHandlers(this, {
 *       handlerClasses: HANDLER_CLASSES,
 *       externalServices: ['API_BUSINESS_PARTNER'],
 *       utilities: { sequenceManager: new SequenceManager() },
 *     });
 *     return super.init();
 *   }
 * }
 * ```
 */
export async function registerHandlers(
  srv: ApplicationService,
  options?: {
    externalServices?: string[];
    utilities?: Record<string, any>;
    config?: any;
    baseDir?: string;
    handlerClasses?: any[];
  }
): Promise<HandlerRegistry> {
  const contextBuilder = createHandlerContext(srv);

  await contextBuilder.withDatabase();

  if (options?.externalServices) {
    await contextBuilder.withExternalServices(options.externalServices);
  }

  if (options?.utilities) {
    contextBuilder.withUtilities(options.utilities);
  }

  if (options?.config) {
    contextBuilder.withConfig(options.config);
  }

  const context = contextBuilder.build();
  const registry = new HandlerRegistry(context);

  if (options?.handlerClasses && options.handlerClasses.length > 0) {
    await registry.registerFromClasses(options.handlerClasses);
  } else {
    const baseDir = options?.baseDir || __dirname + '/..';
    await registry.registerAll(baseDir);
  }

  return registry;
}

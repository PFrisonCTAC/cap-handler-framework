/**
 * @module @kreglinger/cds-handler-framework
 * Handler Registry - Auto-discovery and registration of handlers
 */

import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { ApplicationService } from '@sap/cds';
import type { 
  HandlerContext, 
  HandlerMetadata, 
  EventRegistration, 
  CAPEvent, 
  EventPhase 
} from './types';
import { BaseHandler } from './BaseHandler';
import { createHandlerContext } from './HandlerContext';

/**
 * Method name to event mapping
 */
const METHOD_TO_EVENT_MAP: Record<string, CAPEvent> = {
  'create': 'CREATE',
  'read': 'READ',
  'update': 'UPDATE',
  'patch': 'PATCH',
  'delete': 'DELETE',
  'new': 'NEW',
  'edit': 'EDIT',
  'save': 'SAVE',
  'cancel': 'CANCEL',
  'discard': 'DISCARD',
};

/**
 * Handler Registry - manages handler discovery and registration
 */
export class HandlerRegistry {
  private context: HandlerContext;
  private handlers: Map<string, HandlerMetadata> = new Map();
  private handlerDirectory: string;

  constructor(context: HandlerContext) {
    this.context = context;
    this.handlerDirectory = context.config.handlerDirectory || './handlers';
  }

  /**
   * Discover and register all handlers in the configured directory
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
   * Discover handler files recursively
   */
  private async discoverHandlers(directory: string): Promise<void> {
    try {
      const entries = readdirSync(directory);

      for (const entry of entries) {
        const fullPath = join(directory, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip 'core' and 'utils' directories
          if (entry === 'core' || entry === 'utils') continue;
          
          // Recursively scan subdirectories
          await this.discoverHandlers(fullPath);
        } else if (stat.isFile()) {
          // Process both TypeScript and JavaScript files ending with 'Handler'
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

  /**
   * Load a single handler file
   */
  private async loadHandler(filePath: string): Promise<void> {
    try {
      // Convert absolute path to file:// URL for dynamic import
      // This is required for Node.js ESM/TypeScript compatibility
      const ext = extname(filePath);
      const pathWithoutExt = filePath.substring(0, filePath.length - ext.length);
      
      // Use file:// URL protocol for absolute paths
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

      // Check if it extends BaseHandler
      if (!(HandlerClass.prototype instanceof BaseHandler)) {
        this.context.logger.warn(`${filePath} does not extend BaseHandler`);
        return;
      }

      // Instantiate the handler
      const handlerInstance = new HandlerClass(this.context);
      const entityName = handlerInstance.getEntityName();

      if (!entityName) {
        this.context.logger.warn(`Handler in ${filePath} has no entity name`);
        return;
      }

      // Store handler metadata
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

  /**
   * Register all discovered handlers
   */
  private async registerHandlers(): Promise<void> {
    for (const [entityName, metadata] of this.handlers) {
      await this.registerHandler(metadata);
    }
  }

  /**
   * Register a single handler
   */
  private async registerHandler(metadata: HandlerMetadata): Promise<void> {
    const { instance, entityName } = metadata;
    const entity = this.context.srv.entities[entityName];

    if (!entity) {
      this.context.logger.warn(`Entity ${entityName} not found in service`);
      return;
    }

    // Store entity reference in handler
    instance.entity = entity;

    // Discover and register convention-based methods
    this.registerConventionBasedMethods(metadata, entity);

    // Call handler initialization
    await instance.onInit();

    this.context.logger.info(
      `Registered ${metadata.registrations.length} event(s) for ${entityName}`
    );
  }

  /**
   * Register convention-based handler methods
   */
  private registerConventionBasedMethods(metadata: HandlerMetadata, entity: any): void {
    const { instance, entityName, handlesDrafts } = metadata;
    
    // Collect methods from the handler and all parent classes
    const methods = new Set<string>();
    let currentProto = Object.getPrototypeOf(instance);
    
    // Walk up the prototype chain to collect all methods
    while (currentProto && currentProto !== Object.prototype) {
      const protoMethods = Object.getOwnPropertyNames(currentProto);
      for (const method of protoMethods) {
        methods.add(method);
      }
      currentProto = Object.getPrototypeOf(currentProto);
    }

    for (const methodName of methods) {
      // Skip constructor and lifecycle methods
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

      // Parse method name for phase and event
      const parsed = this.parseMethodName(methodName);
      if (!parsed) continue;

      const { phase, event, isDraftSpecific, isActiveOnly } = parsed;

      // Determine which entities to register on
      let entities: any[];
      
      if (isDraftSpecific) {
        // Method name contains 'Draft' -> only register on drafts
        entities = [entity.drafts];
      } else if (isActiveOnly) {
        // Method name contains 'Active' -> only register on active entity
        entities = [entity];
      } else if (handlesDrafts && this.context.config.enableDraftSupport) {
        // Handler opts into draft support -> register on both
        entities = [entity, entity.drafts];
      } else {
        // Default: only active entity
        entities = [entity];
      }

      // Register the event handler
      this.registerEventHandler(phase, event, entities, instance, methodName, metadata);
    }
  }

  /**
   * Parse a method name to extract phase, event, and modifiers
   * 
   * Examples:
   * - beforeCreate -> { phase: 'before', event: 'CREATE' }
   * - onRead -> { phase: 'on', event: 'READ' }
   * - afterUpdateDraft -> { phase: 'after', event: 'UPDATE', isDraftSpecific: true }
   * - beforeEditActive -> { phase: 'before', event: 'EDIT', isActiveOnly: true }
   */
  private parseMethodName(methodName: string): {
    phase: EventPhase;
    event: CAPEvent;
    isDraftSpecific?: boolean;
    isActiveOnly?: boolean;
  } | null {
    // Determine phase
    let phase: EventPhase;
    let remainder: string;

    if (methodName.startsWith('before')) {
      phase = 'before';
      remainder = methodName.substring(6); // Remove 'before'
    } else if (methodName.startsWith('after')) {
      phase = 'after';
      remainder = methodName.substring(5); // Remove 'after'
    } else if (methodName.startsWith('on')) {
      phase = 'on';
      remainder = methodName.substring(2); // Remove 'on'
    } else {
      return null;
    }

    if (!remainder) return null;

    // Check for modifiers
    let isDraftSpecific = false;
    let isActiveOnly = false;

    if (remainder.endsWith('Draft')) {
      isDraftSpecific = true;
      remainder = remainder.substring(0, remainder.length - 5); // Remove 'Draft'
    } else if (remainder.endsWith('Active')) {
      isActiveOnly = true;
      remainder = remainder.substring(0, remainder.length - 6); // Remove 'Active'
    }

    // Map to CAP event
    const eventKey = remainder.toLowerCase();
    const event = METHOD_TO_EVENT_MAP[eventKey];

    if (!event) return null;

    return { phase, event, isDraftSpecific, isActiveOnly };
  }

  /**
   * Register an event handler with CAP
   */
  private registerEventHandler(
    phase: EventPhase,
    event: CAPEvent | string,
    entities: any[],
    instance: any,
    methodName: string,
    metadata: HandlerMetadata
  ): void {
    const srv = this.context.srv;

    // Store registration metadata
    metadata.registrations.push({
      phase,
      event,
      methodName,
      entities,
    });

    // Bind handler to instance
    const boundHandler = instance[methodName].bind(instance);

    // Register with CAP
    switch (phase) {
      case 'before':
        srv.before(event, entities, boundHandler);
        break;
      case 'on':
        srv.on(event, entities, boundHandler);
        break;
      case 'after':
        srv.after(event, entities, boundHandler);
        break;
    }

    const entityNames = entities.map((e) => e.name || 'unknown').join(', ');
    this.context.logger.debug(
      `Registered ${phase}('${event}') on [${entityNames}] -> ${metadata.entityName}.${methodName}`
    );
  }

  /**
   * Get handler metadata by entity name
   */
  getHandler(entityName: string): HandlerMetadata | undefined {
    return this.handlers.get(entityName);
  }

  /**
   * Get all registered handlers
   */
  getAllHandlers(): HandlerMetadata[] {
    return Array.from(this.handlers.values());
  }

  /**
   * Destroy all handlers (cleanup)
   */
  async destroyAll(): Promise<void> {
    for (const metadata of this.handlers.values()) {
      try {
        await metadata.instance.onDestroy();
      } catch (error) {
        this.context.logger.error(`Error destroying handler for ${metadata.entityName}:`, error);
      }
    }
    this.handlers.clear();
  }

  /**
   * Register handlers from explicit class list (avoids dynamic import issues)
   */
  async registerFromClasses(handlerClasses: any[]): Promise<void> {
    this.context.logger.info(`Registering ${handlerClasses.length} handler class(es)...`);

    for (const HandlerClass of handlerClasses) {
      try {
        // Check if it extends BaseHandler
        if (!(HandlerClass.prototype instanceof BaseHandler)) {
          this.context.logger.warn(`Handler class does not extend BaseHandler`);
          continue;
        }

        // Instantiate the handler
        const handlerInstance = new HandlerClass(this.context);
        const entityName = handlerInstance.getEntityName();

        if (!entityName) {
          this.context.logger.warn(`Handler has no entity name`);
          continue;
        }

        // Store handler metadata
        const metadata: HandlerMetadata = {
          entityName,
          handlesDrafts: handlerInstance.shouldHandleDrafts(),
          registrations: [],
          instance: handlerInstance,
        };

        this.handlers.set(entityName, metadata);
        this.context.logger.info(`Loaded handler for ${entityName}`);
      } catch (error) {
        this.context.logger.error(`Failed to load handler class:`, error);
      }
    }

    // Register all loaded handlers
    await this.registerHandlers();
    
    this.context.logger.info(`Successfully registered ${this.handlers.size} handler(s)`);
  }
}

/**
 * Helper function to register handlers for a service
 * 
 * @example
 * ```typescript
 * export class OpportunityManagementService extends ApplicationService {
 *   async init() {
 *     await registerHandlers(this, {
 *       externalServices: ['API_BUSINESS_PARTNER', 'API_PRODUCT_SRV'],
 *       utilities: { sequenceManager: new SequenceManager() }
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

  // Load database
  await contextBuilder.withDatabase();

  // Load external services
  if (options?.externalServices) {
    await contextBuilder.withExternalServices(options.externalServices);
  }

  // Register utilities
  if (options?.utilities) {
    contextBuilder.withUtilities(options.utilities);
  }

  // Configure
  if (options?.config) {
    contextBuilder.withConfig(options.config);
  }

  const context = contextBuilder.build();
  const registry = new HandlerRegistry(context);

  // Register handlers - prefer explicit classes over discovery
  if (options?.handlerClasses && options.handlerClasses.length > 0) {
    await registry.registerFromClasses(options.handlerClasses);
  } else {
    // Fall back to file discovery (may have issues with TypeScript)
    const baseDir = options?.baseDir || __dirname + '/..';
    await registry.registerAll(baseDir);
  }

  return registry;
}

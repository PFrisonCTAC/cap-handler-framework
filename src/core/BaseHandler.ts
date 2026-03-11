/**
 * @module @kreglinger/cds-handler-framework
 * Base Handler - Abstract base class for all entity handlers
 */

import cds from '@sap/cds';
import type { ApplicationService, Request } from '@sap/cds';
import type { 
  HandlerContext, 
  TypedRequest, 
  Logger,
  ExpandConfig,
  DeepCopyOptions 
} from './types';
import { getExternalService, getUtility } from './HandlerContext';
import { ExpandTree } from '../utils/ExpandTree';
import { VirtualElementFilter } from '../utils/VirtualElementFilter';

/**
 * Abstract base class for entity handlers
 * 
 * Extend this class to create handlers for your entities.
 * 
 * @example
 * ```typescript
 * export class TradeSlipsHandler extends BaseHandler<TradeSlips> {
 *   getEntityName() { return 'TradeSlips'; }
 *   shouldHandleDrafts() { return true; }
 *   
 *   async beforeCreate(req: TypedRequest<TradeSlips>) {
 *     req.data.index = await this.generateIndex();
 *   }
 * }
 * ```
 */
export abstract class BaseHandler<T = any> {
  /**
   * CAP service instance
   */
  protected readonly srv: ApplicationService;

  /**
   * Handler context with dependencies
   */
  protected readonly context: HandlerContext;

  /**
   * Logger instance
   */
  protected readonly logger: Logger;

  /**
   * Database connection
   */
  protected readonly db: any;

  /**
   * Entity definition
   */
  protected entity: any;

  /**
   * Expand tree - tracks which paths are expanded (from Elia CO2)
   */
  protected expandTree?: ExpandTree;

  /**
   * Virtual element filter - strips virtual fields from queries (from Elia CO2)
   */
  protected virtualFilter?: VirtualElementFilter;

  constructor(context: HandlerContext) {
    this.context = context;
    this.srv = context.srv;
    this.logger = context.logger;
    this.db = context.db;
    
    // Initialize virtual element filter
    if (context.db) {
      this.virtualFilter = new VirtualElementFilter(context.db);
    }
  }

  // ===========================
  // ABSTRACT METHODS
  // ===========================

  /**
   * Get the entity name this handler manages
   * Must be implemented by subclasses
   */
  abstract getEntityName(): string;

  /**
   * Whether this handler should register for draft entities
   * @default false
   */
  shouldHandleDrafts(): boolean {
    return false;
  }

  // ===========================
  // LIFECYCLE HOOKS
  // ===========================

  /**
   * Called after handler is registered
   * Use this to perform initialization
   */
  async onInit(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Called before handler is destroyed
   * Use this to perform cleanup
   */
  async onDestroy(): Promise<void> {
    // Override in subclass if needed
  }

  // ===========================
  // HELPER METHODS
  // ===========================

  /**
   * Get a transaction for the current request
   */
  protected tx(req: Request): any {
    return cds.tx(req);
  }

  /**
   * Get an external service connection
   */
  protected getExternalService(serviceName: string): any {
    return getExternalService(this.context, serviceName);
  }

  /**
   * Get a utility instance
   */
  protected getUtility<U = any>(utilityName: string): U | undefined {
    return getUtility<U>(this.context, utilityName);
  }

  /**
   * Get the chunk size for batch operations
   */
  protected getChunkSize(): number {
    return this.context.config.chunkSize || 80;
  }

  /**
   * Enrich data with expanded associations from remote services
   * 
   * @param data - Data rows to enrich
   * @param req - Request context
   * @param expands - Expand configurations
   * @returns Enriched data
   */
  protected async enrichExpands(
    data: any,
    req: Request,
    expands: ExpandConfig[] | string[]
  ): Promise<any> {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return data;

    // Convert string expands to configs
    const expandConfigs: ExpandConfig[] = expands.map((exp) => {
      if (typeof exp === 'string') {
        // Simple expand - needs to be configured in subclass
        throw new Error(
          `Expand '${exp}' requires ExpandConfig. Override enrichExpands or provide ExpandConfig.`
        );
      }
      return exp;
    });

    for (const expand of expandConfigs) {
      await this.enrichSingleExpand(rows, expand);
    }

    return Array.isArray(data) ? rows : rows[0] || null;
  }

  /**
   * Enrich a single expand field
   */
  private async enrichSingleExpand(rows: any[], expand: ExpandConfig): Promise<void> {
    const remoteService = this.getExternalService(expand.remoteService);
    if (!remoteService) {
      this.logger.warn(`Cannot enrich ${expand.name}: service ${expand.remoteService} not found`);
      return;
    }

    // Extract unique keys to fetch
    const keysMap = expand.keyMapping;
    const keyField = Object.keys(keysMap)[0];
    const remoteKeyField = keysMap[keyField];

    const uniqueKeys = Array.from(
      new Set(
        rows
          .map((r) => r?.[keyField])
          .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
          .map((k) => k.trim())
      )
    );

    if (uniqueKeys.length === 0) {
      rows.forEach((r) => (r[expand.name] = null));
      return;
    }

    // Fetch in chunks
    const dataById = new Map<string, any>();
    const chunkSize = expand.chunkSize || this.getChunkSize();

    for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
      const chunk = uniqueKeys.slice(i, i + chunkSize);

      let query = SELECT.from(expand.remoteEntity).where({ [remoteKeyField]: { in: chunk } });

      if (expand.columns) {
        query = query.columns(expand.columns);
      }

      const result = await remoteService.run(query);
      const resultRows = Array.isArray(result) ? result : result ? [result] : [];

      for (const row of resultRows) {
        const id = row?.[remoteKeyField];
        if (typeof id === 'string' && id.length > 0) {
          dataById.set(id, row);
        }
      }
    }

    // Enrich rows
    rows.forEach((r) => {
      const key = r?.[keyField];
      r[expand.name] = typeof key === 'string' ? dataById.get(key.trim()) ?? null : null;
    });
  }

  /**
   * Deep copy an entity with compositions
   * 
   * @param source - Source entity data
   * @param options - Copy options
   * @returns Copied entity
   */
  protected async deepCopy(source: any, options?: DeepCopyOptions): Promise<any> {
    const opts: DeepCopyOptions = {
      excludeFields: ['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'],
      generateNewIds: true,
      idGenerator: () => cds.utils.uuid(),
      includeCompositions: true,
      ...options,
    };

    const copy = { ...source };

    // Exclude fields
    for (const field of opts.excludeFields || []) {
      delete copy[field];
    }

    // Generate new ID
    if (opts.generateNewIds && opts.idGenerator) {
      copy.ID = opts.idGenerator();
    }

    // Apply field transformers
    if (opts.fieldTransformers) {
      for (const [field, transformer] of Object.entries(opts.fieldTransformers)) {
        if (copy[field] !== undefined) {
          copy[field] = transformer(copy[field]);
        }
      }
    }

    // Handle compositions (deep copy children)
    if (opts.includeCompositions) {
      for (const key of Object.keys(copy)) {
        if (Array.isArray(copy[key])) {
          copy[key] = await Promise.all(
            copy[key].map((child: any) => this.deepCopy(child, opts))
          );
        }
      }
    }

    return copy;
  }

  /**
   * Count related entities
   * 
   * @param entityName - Entity to count
   * @param where - Filter condition
   * @returns Count
   */
  protected async count(entityName: string, where: any): Promise<number> {
    const result = await SELECT.from(entityName)
      .columns('count(*) as cnt')
      .where(where);

    return result?.[0]?.cnt || 0;
  }

  /**
   * Log performance metrics
   */
  protected async logPerformance<R>(
    operation: string,
    fn: () => Promise<R>
  ): Promise<R> {
    if (!this.context.config.enablePerformanceLogging) {
      return fn();
    }

    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.logger.info(`[${this.getEntityName()}] ${operation} completed in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.logger.error(`[${this.getEntityName()}] ${operation} failed after ${duration}ms:`, error);
      throw error;
    }
  }

  /**
   * Normalize data to array
   */
  protected toArray<D = any>(data: D | D[]): D[] {
    return Array.isArray(data) ? data : data ? [data] : [];
  }

  /**
   * Check if request is for a single entity
   */
  protected isSingleRequest(req: Request): boolean {
    return !!req.query?.SELECT?.one;
  }

  /**
   * Return data in the shape expected by the request
   */
  protected formatResponse<D = any>(data: D[], req: Request): D | D[] | null {
    return this.isSingleRequest(req) ? (data[0] ?? null) : data;
  }

  // ===========================
  // ELIA CO2 ENHANCEMENTS
  // ===========================

  /**
   * Initialize expand tree from request (call at start of handler)
   * FROM: Elia CO2 BaseHandler.beforeAll()
   */
  protected initializeExpandTree(req: Request): void {
    this.expandTree = ExpandTree.fromRequest(req);
  }

  /**
   * Check if a path is expanded in the current request
   * FROM: Elia CO2 BaseHandler.isExpanded()
   * 
   * @param path - Path to check (e.g., 'businessPartner' or ['to_Items', 'product'])
   * @returns true if path is expanded
   * 
   * @example
   * ```typescript
   * async onRead(req, next) {
   *   this.initializeExpandTree(req);
   *   const result = await next();
   *   
   *   // Only enrich if actually requested
   *   if (this.isExpanded('businessPartner')) {
   *     await this.enrichBusinessPartner(result);
   *   }
   *   
   *   return result;
   * }
   * ```
   */
  protected isExpanded(path: string | string[]): boolean {
    return this.expandTree?.has(path) ?? false;
  }

  /**
   * Strip virtual/computed elements from query
   * FROM: Elia CO2 BaseHandler.getNonVirtualQuery()
   * 
   * @param query - Original query
   * @param entityName - Entity name (defaults to handler's entity)
   * @returns Query without virtual elements
   * 
   * @example
   * ```typescript
   * const cleanQuery = this.stripVirtualElements(req.query);
   * const result = await this.db.run(cleanQuery);
   * ```
   */
  protected stripVirtualElements(query: any, entityName?: string): any {
    if (!this.virtualFilter) {
      return query;
    }
    return this.virtualFilter.stripVirtualElements(query, entityName || this.getEntityName());
  }

  /**
   * Check if a field is virtual
   * FROM: Elia CO2 VirtualElementFilter.isVirtual()
   */
  protected isVirtualField(fieldName: string, entityName?: string): boolean {
    if (!this.virtualFilter) {
      return false;
    }
    return this.virtualFilter.isVirtual(entityName || this.getEntityName(), fieldName);
  }

  /**
   * Get all virtual fields for the entity
   * FROM: Elia CO2 VirtualElementFilter.getVirtualFields()
   */
  protected getVirtualFields(entityName?: string): string[] {
    if (!this.virtualFilter) {
      return [];
    }
    return this.virtualFilter.getVirtualFields(entityName || this.getEntityName());
  }

  /**
   * Filter WHERE clause to remove entity prefix from refs
   * FROM: Elia CO2 BaseHandler.filterWhere()
   * 
   * Normalizes: TradeSlips.customerNumber → customerNumber
   * 
   * @param where - WHERE clause array
   * @param entityName - Entity name to strip
   * @returns Normalized WHERE clause
   */
  protected filterWhere(where: any[], entityName: string): any[] {
    if (!where || !Array.isArray(where)) return where;

    const newWhere: any[] = [];
    let keepNext: string = '';
    let idx = 0;

    while (idx < where.length) {
      const prop = where[idx];

      // Handle ref with entity prefix
      if (prop?.ref && Array.isArray(prop.ref) && prop.ref.length > 1 && prop.ref[0] === entityName) {
        if (newWhere.length > 0 && keepNext) {
          newWhere.push(keepNext);
        }
        newWhere.push({ ref: [prop.ref[1]] });
        newWhere.push(where[idx + 1]);
        newWhere.push(where[idx + 2]);
        keepNext = where[idx + 3];
        idx += 4;
      }
      // Handle xpr (nested expressions)
      else if (prop?.xpr && Array.isArray(prop.xpr) && prop.xpr.length > 0) {
        const filteredXpr = this.filterWhere(prop.xpr, entityName);
        if (filteredXpr.length > 0) {
          if (newWhere.length > 0 && keepNext) {
            newWhere.push(keepNext);
          }
          newWhere.push({ xpr: filteredXpr });
          keepNext = where[idx + 1];
        }
        idx += 2;
      } else {
        idx += 1;
      }
    }

    return newWhere;
  }

  /**
   * Exclude entity references from WHERE clause
   * FROM: Elia CO2 BaseHandler.excludeEntityFromWhere()
   * 
   * @param where - WHERE clause array
   * @param entityName - Entity to exclude
   */
  protected excludeEntityFromWhere(where: any[], entityName: string): void {
    let entityFoundIdx = -1;

    do {
      entityFoundIdx = where.findIndex(
        (item) => item?.ref && item.ref.length > 1 && item.ref[0] === entityName
      );
      if (entityFoundIdx > -1) {
        where.splice(entityFoundIdx, 4);
      }
    } while (entityFoundIdx > -1);

    // Recurse into xpr
    for (const item of where) {
      if (item?.xpr && Array.isArray(item.xpr) && item.xpr.length > 0) {
        this.excludeEntityFromWhere(item.xpr, entityName);
      }
    }

    // Clean up empty xpr
    let isEmptyIdx = -1;
    do {
      isEmptyIdx = where.findIndex((item) => item?.xpr && item.xpr.length === 0);
      if (isEmptyIdx > -1) {
        where.splice(isEmptyIdx, 2);
      }
    } while (isEmptyIdx > -1);
  }
}

/**
 * @module @kreglinger/cds-handler-framework
 * Type definitions for the CAP Handler Framework
 */

import type { Request, ApplicationService } from '@sap/cds';

/**
 * Logger type (imported from cds)
 */
export type Logger = ReturnType<typeof import('@sap/cds').log>;

/**
 * CAP Event types (standard CRUD + draft lifecycle)
 */
export type CAPEvent = 
  | 'CREATE' 
  | 'READ' 
  | 'UPDATE' 
  | 'PATCH'
  | 'DELETE'
  | 'NEW'
  | 'EDIT'
  | 'SAVE'
  | 'CANCEL'
  | 'DISCARD';

/**
 * Event phase types
 */
export type EventPhase = 'before' | 'on' | 'after';

/**
 * Typed request with entity type inference
 */
export interface TypedRequest<T = any> extends Request {
  data: T;
  query: any;
  params: any[];
}

/**
 * Handler method signature for before phase
 */
export type BeforeHandler<T = any> = (req: TypedRequest<T>) => Promise<void> | void;

/**
 * Handler method signature for on phase
 */
export type OnHandler<T = any> = (req: TypedRequest<T>, next?: () => Promise<any>) => Promise<any> | any;

/**
 * Handler method signature for after phase
 */
export type AfterHandler<T = any> = (data: T | T[], req: TypedRequest<T>) => Promise<void> | void;

/**
 * External service configuration
 */
export interface ExternalServiceConfig {
  name: string;
  kind: 'odata' | 'odata-v2' | 'odata-v4' | 'rest';
  credentials?: any;
}

/**
 * Shared utilities available to all handlers
 */
export interface HandlerUtilities {
  sequenceManager?: any;
  queryHelper?: any;
  enrichmentHelper?: any;
  [key: string]: any;
}

/**
 * Framework configuration
 */
export interface FrameworkConfig {
  /**
   * Enable automatic draft entity registration
   * @default true
   */
  enableDraftSupport?: boolean;

  /**
   * Chunk size for batch operations
   * @default 80
   */
  chunkSize?: number;

  /**
   * Enable draft garbage collection
   * @default true
   */
  enableDraftGC?: boolean;

  /**
   * Enable performance logging
   * @default false
   */
  enablePerformanceLogging?: boolean;

  /**
   * Cache handler metadata
   * @default true
   */
  cacheMetadata?: boolean;

  /**
   * Custom handler directory
   * @default './handlers'
   */
  handlerDirectory?: string;

  /**
   * Enable decorator support
   * @default true
   */
  enableDecorators?: boolean;
}

/**
 * Handler context - shared dependencies injected into all handlers
 */
export interface HandlerContext {
  /**
   * The CAP service instance
   */
  srv: ApplicationService;

  /**
   * Logger instance
   */
  logger: Logger;

  /**
   * Database connection
   */
  db: any;

  /**
   * External service connections
   */
  externalServices: Map<string, any>;

  /**
   * Shared utilities
   */
  utilities: HandlerUtilities;

  /**
   * Framework configuration
   */
  config: FrameworkConfig;
}

/**
 * Handler registration metadata
 */
export interface HandlerMetadata {
  /**
   * Entity name this handler manages
   */
  entityName: string;

  /**
   * Whether this handler manages draft entities
   */
  handlesDrafts: boolean;

  /**
   * Event registrations
   */
  registrations: EventRegistration[];

  /**
   * Handler class instance
   */
  instance: any;
}

/**
 * Event registration details
 */
export interface EventRegistration {
  phase: EventPhase;
  event: CAPEvent | string;
  methodName: string;
  entities: any[];
  isDraftSpecific?: boolean;
  isActiveOnly?: boolean;
  /**
   * Whether this is a bound action (registered on entity, no phase prefix)
   */
  isBoundAction?: boolean;
  /**
   * Whether this is an unbound action (registered at service level, no entity)
   */
  isUnboundAction?: boolean;
  /**
   * Whether this is a bound function (registered on entity, no phase prefix)
   */
  isBoundFunction?: boolean;
  /**
   * Whether this is an unbound function (registered at service level, no entity)
   */
  isUnboundFunction?: boolean;
}

/**
 * Parsed method name result
 */
export interface ParsedMethodName {
  phase: EventPhase;
  event: CAPEvent | string;
  isDraftSpecific?: boolean;
  isActiveOnly?: boolean;
  isBoundAction?: boolean;
  isUnboundAction?: boolean;
  isBoundFunction?: boolean;
  isUnboundFunction?: boolean;
}

/**
 * Decorator metadata storage
 */
export interface DecoratorMetadata {
  target: any;
  propertyKey: string;
  phase?: EventPhase;
  event?: CAPEvent | CAPEvent[];
  entities?: any[];
  options?: DecoratorOptions;
}

/**
 * Decorator options
 */
export interface DecoratorOptions {
  /**
   * Apply to drafts
   */
  drafts?: boolean;

  /**
   * Apply only to active entities
   */
  activeOnly?: boolean;

  /**
   * Apply only to draft entities
   */
  draftsOnly?: boolean;

  /**
   * Custom entity override
   */
  entity?: any;

  /**
   * Transaction mode
   */
  transaction?: boolean;

  /**
   * Enable caching
   */
  cache?: {
    ttl: number;
    key?: string;
  };

  /**
   * Enable performance logging
   */
  logPerformance?: boolean;
}

/**
 * Expand configuration for enrichment
 */
export interface ExpandConfig {
  /**
   * Name of the expand field
   */
  name: string;

  /**
   * Remote service to fetch from
   */
  remoteService: string;

  /**
   * Remote entity to query
   */
  remoteEntity: string;

  /**
   * Key mapping (local field -> remote field)
   */
  keyMapping: Record<string, string>;

  /**
   * Columns to select
   */
  columns?: string[];

  /**
   * Chunk size for batch fetching
   */
  chunkSize?: number;
}

/**
 * Query forwarding options
 */
export interface ForwardQueryOptions {
  /**
   * Remote entity name
   */
  remoteEntity: string;

  /**
   * Strip $count from query
   */
  stripCount?: boolean;

  /**
   * Forbidden columns to exclude
   */
  forbiddenColumns?: string[];

  /**
   * Strip navigation properties
   */
  stripNavigations?: string[];

  /**
   * Additional where conditions
   */
  additionalWhere?: any;
}

/**
 * Deep copy options
 */
export interface DeepCopyOptions {
  /**
   * Fields to exclude from copy
   */
  excludeFields?: string[];

  /**
   * Generate new UUIDs
   */
  generateNewIds?: boolean;

  /**
   * Custom ID generator
   */
  idGenerator?: () => string;

  /**
   * Process child compositions
   */
  includeCompositions?: boolean;

  /**
   * Custom field transformers
   */
  fieldTransformers?: Record<string, (value: any) => any>;
}

/**
 * Export all types
 */
export type {
  Request,
  ApplicationService
};

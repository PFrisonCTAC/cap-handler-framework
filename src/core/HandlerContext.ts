/**
 * @module @kreglinger/cds-handler-framework
 * Handler Context - Dependency injection container
 */

import cds from '@sap/cds';
import type { ApplicationService } from '@sap/cds';
import type { HandlerContext, HandlerUtilities, FrameworkConfig, Logger } from './types';

/**
 * Default framework configuration
 */
const DEFAULT_CONFIG: FrameworkConfig = {
  enableDraftSupport: true,
  chunkSize: 80,
  enableDraftGC: true,
  enablePerformanceLogging: false,
  cacheMetadata: true,
  handlerDirectory: './handlers',
  enableDecorators: true,
};

/**
 * Builder for creating handler context with all dependencies
 */
export class HandlerContextBuilder {
  private srv: ApplicationService;
  private logger: Logger;
  private db: any;
  private externalServices: Map<string, any> = new Map();
  private utilities: HandlerUtilities = {};
  private config: FrameworkConfig = { ...DEFAULT_CONFIG };

  constructor(srv: ApplicationService) {
    this.srv = srv;
    this.logger = cds.log(`${srv.name}-handlers`);
  }

  /**
   * Load database connection
   */
  async withDatabase(): Promise<this> {
    this.db = await cds.connect.to('db');
    return this;
  }

  /**
   * Load external services by name
   */
  async withExternalServices(serviceNames: string[]): Promise<this> {
    for (const serviceName of serviceNames) {
      try {
        const service = await cds.connect.to(serviceName);
        this.externalServices.set(serviceName, service);
        this.logger.info(`Connected to external service: ${serviceName}`);
      } catch (error) {
        this.logger.warn(`Failed to connect to ${serviceName}: ${error}`);
      }
    }
    return this;
  }

  /**
   * Add a single external service
   */
  async withExternalService(serviceName: string, alias?: string): Promise<this> {
    try {
      const service = await cds.connect.to(serviceName);
      this.externalServices.set(alias || serviceName, service);
      this.logger.info(`Connected to external service: ${serviceName}${alias ? ` as ${alias}` : ''}`);
    } catch (error) {
      this.logger.warn(`Failed to connect to ${serviceName}: ${error}`);
    }
    return this;
  }

  /**
   * Register utility instances
   */
  withUtilities(utilities: HandlerUtilities): this {
    this.utilities = { ...this.utilities, ...utilities };
    return this;
  }

  /**
   * Register a single utility
   */
  withUtility(name: string, utility: any): this {
    this.utilities[name] = utility;
    return this;
  }

  /**
   * Configure framework options
   */
  withConfig(config: Partial<FrameworkConfig>): this {
    this.config = { ...this.config, ...config };
    return this;
  }

  /**
   * Build the handler context
   */
  build(): HandlerContext {
    return {
      srv: this.srv,
      logger: this.logger,
      db: this.db,
      externalServices: this.externalServices,
      utilities: this.utilities,
      config: this.config,
    };
  }
}

/**
 * Helper function to create a handler context builder
 */
export function createHandlerContext(srv: ApplicationService): HandlerContextBuilder {
  return new HandlerContextBuilder(srv);
}

/**
 * Helper to get an external service from context
 */
export function getExternalService(context: HandlerContext, serviceName: string): any {
  const service = context.externalServices.get(serviceName);
  if (!service) {
    context.logger.warn(`External service '${serviceName}' not found in context`);
  }
  return service;
}

/**
 * Helper to get a utility from context
 */
export function getUtility<T = any>(context: HandlerContext, utilityName: string): T | undefined {
  return context.utilities[utilityName] as T;
}

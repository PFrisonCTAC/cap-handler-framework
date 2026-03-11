/**
 * @module @kreglinger/cds-handler-framework
 * Proxy Handler - Base class for proxying external service entities
 */

import type { Request } from '@sap/cds';
import { BaseHandler } from './BaseHandler';
import type { TypedRequest, ForwardQueryOptions } from './types';

/**
 * Abstract base class for proxy handlers that forward requests to external services
 * 
 * @example
 * ```typescript
 * export class BusinessPartnersProxyHandler extends ProxyHandler {
 *   getEntityName() { return 'BusinessPartners'; }
 *   getRemoteService() { return 'API_BUSINESS_PARTNER'; }
 *   getRemoteEntity() { return 'A_BusinessPartner'; }
 * }
 * ```
 */
export abstract class ProxyHandler extends BaseHandler {
  /**
   * Get the remote service name to proxy to
   */
  abstract getRemoteService(): string;

  /**
   * Get the remote entity name
   */
  abstract getRemoteEntity(): string;

  /**
   * Get columns that should not be forwarded to the remote service
   * Override this to exclude CAP-only fields
   */
  protected getForbiddenColumns(): string[] {
    return [];
  }

  /**
   * Get navigation properties that should not be forwarded
   * Override this for CAP-only associations
   */
  protected getStripNavigations(): string[] {
    return [];
  }

  /**
   * Default READ handler - proxies to remote service
   * Override this to add custom logic
   */
  async onRead(req: TypedRequest, next?: () => Promise<any>): Promise<any> {
    const remoteService = this.getExternalService(this.getRemoteService());
    
    if (!remoteService) {
      this.logger.error(`Remote service '${this.getRemoteService()}' not available`);
      return this.formatResponse([], req);
    }

    const forwardOptions: ForwardQueryOptions = {
      remoteEntity: this.getRemoteEntity(),
      stripCount: true,
      forbiddenColumns: this.getForbiddenColumns(),
      stripNavigations: this.getStripNavigations(),
    };

    const cleanedQuery = this.buildForwardQuery(req.query, forwardOptions);
    
    try {
      const result = await remoteService.run(cleanedQuery);
      return result;
    } catch (error) {
      this.logger.error(`Error proxying to ${this.getRemoteService()}.${this.getRemoteEntity()}:`, error);
      throw error;
    }
  }

  /**
   * Build a cleaned query for forwarding to remote service
   */
  protected buildForwardQuery(originalQuery: any, options: ForwardQueryOptions): any {
    const cleanedQuery: any = SELECT.from(options.remoteEntity);
    const originalSelect = originalQuery?.SELECT;

    // Handle columns
    if (Array.isArray(originalSelect?.columns) && originalSelect.columns.length > 0) {
      const forbiddenSet = new Set(options.forbiddenColumns || []);
      const stripNavSet = new Set(options.stripNavigations || []);
      
      const filteredColumns = originalSelect.columns
        .filter((c: any) => {
          // Remove count-ish columns
          const isFuncCount = typeof c?.func === 'string' && c.func.toLowerCase() === 'count';
          const isRefCount = Array.isArray(c?.ref) && (c.ref[0] === '$count' || c.ref[0] === 'count');
          if (isFuncCount || isRefCount) return false;

          // Remove forbidden columns
          const head = Array.isArray(c?.ref) ? c.ref[0] : undefined;
          if (typeof head === 'string' && forbiddenSet.has(head)) return false;

          // Remove CAP-only navigations
          if (typeof head === 'string' && stripNavSet.has(head)) return false;

          return true;
        })
        .map((c: any) => {
          // Keep expand structures intact for valid navigations
          if (c?.ref && c?.expand) return c;
          // Simple column reference
          if (c?.ref) return { ref: c.ref };
          return c;
        });

      if (filteredColumns.length > 0) {
        cleanedQuery.SELECT.columns = filteredColumns;
      }
    }

    // Copy where clause
    if (originalSelect?.where) {
      cleanedQuery.SELECT.where = originalSelect.where;
    }

    // Copy orderBy
    if (originalSelect?.orderBy) {
      cleanedQuery.SELECT.orderBy = originalSelect.orderBy;
    }

    // Copy limit
    if (originalSelect?.limit?.rows !== undefined) {
      cleanedQuery.SELECT.limit = originalSelect.limit;
    }

    // Strip $count
    if (options.stripCount) {
      delete cleanedQuery.SELECT.count;
    }

    // Add additional where conditions
    if (options.additionalWhere) {
      if (cleanedQuery.SELECT.where) {
        cleanedQuery.SELECT.where = [...cleanedQuery.SELECT.where, 'and', ...options.additionalWhere];
      } else {
        cleanedQuery.SELECT.where = options.additionalWhere;
      }
    }

    return cleanedQuery;
  }

  /**
   * Strip $count and count columns from query
   */
  protected stripCount(select: any): void {
    if (!select) return;
    delete select.count;

    if (Array.isArray(select.columns) && select.columns.length > 0) {
      select.columns = select.columns.filter((c: any) => {
        const isFuncCount = typeof c?.func === 'string' && c.func.toLowerCase() === 'count';
        const isRefCount = Array.isArray(c?.ref) && (c.ref[0] === '$count' || c.ref[0] === 'count');
        return !(isFuncCount || isRefCount);
      });
    }
  }
}

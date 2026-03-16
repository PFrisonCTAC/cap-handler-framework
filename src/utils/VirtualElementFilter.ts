/**
 * Virtual Element Filter - Strip virtual/computed elements from queries
 * 
 * Ported from getNonVirtualQuery.
 * 
 * Prevents query errors by removing @Core.Computed and @cds.virtual elements
 * before executing queries against the database.
 * 
 * @example
 * ```typescript
 * const filter = new VirtualElementFilter(dbService);
 * const cleanQuery = filter.stripVirtualElements(req.query, 'TradeSlips');
 * const result = await db.run(cleanQuery);
 * ```
 */

export class VirtualElementFilter {
  private dbService: any;

  constructor(dbService: any) {
    this.dbService = dbService;
  }

  /**
   * Get non-virtual query by stripping virtual/computed elements
   * 
   * @param query - Original CQN query
   * @param entityName - Name of the entity being queried
   * @returns Cleaned query without virtual elements
   */
  public stripVirtualElements(query: any, entityName: string): any {
    // Clone query to avoid mutating original
    const cleanedQuery = JSON.parse(JSON.stringify(query));
    
    if (!cleanedQuery.SELECT) {
      return cleanedQuery;
    }

    // Get entity definition
    const entity = this.dbService.getEntity(entityName);
    if (!entity || !entity.elements) {
      return cleanedQuery;
    }

    // Categorize elements as virtual or non-virtual
    const { virtual, nonVirtual } = this.categorizeElements(entity.elements);
    const virtualFieldNames = virtual.map((v) => v.ref[0]);

    // Handle columns
    if (cleanedQuery.SELECT.columns?.includes('*')) {
      // Replace '*' with explicit non-virtual columns
      cleanedQuery.SELECT.columns = [
        ...nonVirtual,
        ...cleanedQuery.SELECT.columns.filter((col: any) => col !== '*'),
      ];
    } else if (cleanedQuery.SELECT.columns) {
      // Filter out virtual columns
      cleanedQuery.SELECT.columns = cleanedQuery.SELECT.columns.filter(
        (column: any) => {
          if (typeof column === 'string') return true;
          if (column.ref && virtualFieldNames.includes(column.ref[0])) return false;
          return true;
        }
      );
    } else {
      // No columns specified - add non-virtual columns explicitly
      cleanedQuery.SELECT.columns = nonVirtual;
    }

    // Handle orderBy - remove sorts on virtual fields
    if (cleanedQuery.SELECT.orderBy) {
      cleanedQuery.SELECT.orderBy = cleanedQuery.SELECT.orderBy.filter(
        (sorter: any) => !virtualFieldNames.includes(sorter.ref?.[0])
      );
    }

    // Handle where clause - remove lambda functions (exists) on virtual fields
    if (cleanedQuery.SELECT.where) {
      const existsIndex = cleanedQuery.SELECT.where.findIndex((x: any) => x === 'exists');
      if (existsIndex > -1) {
        // Remove exists clause (typically used with virtual navigations)
        cleanedQuery.SELECT.where.splice(existsIndex + 1, 1); // Remove lambda
        cleanedQuery.SELECT.where.splice(existsIndex, 1); // Remove 'exists'
        if (existsIndex > 0) {
          cleanedQuery.SELECT.where.splice(existsIndex - 1, 1); // Remove 'and/or'
        }
      }
    }

    return cleanedQuery;
  }

  /**
   * Categorize entity elements as virtual or non-virtual
   */
  private categorizeElements(elements: Record<string, any>): {
    virtual: Array<{ ref: string[] }>;
    nonVirtual: Array<{ ref: string[] }>;
  } {
    const result = {
      virtual: [] as Array<{ ref: string[] }>,
      nonVirtual: [] as Array<{ ref: string[] }>,
    };

    for (const [key, element] of Object.entries(elements)) {
      // Skip associations
      if ((element as any).type === 'cds.Association' || (element as any).type === 'cds.Composition') {
        continue;
      }

      // Check if virtual or computed
      const isVirtual =
        (element as any).virtual ||
        (element as any)['@cds.virtual'] ||
        (element as any)['@Core.Computed'];

      if (isVirtual) {
        result.virtual.push({ ref: [key] });
      } else {
        result.nonVirtual.push({ ref: [key] });
      }
    }

    return result;
  }

  /**
   * Check if a field is virtual
   */
  public isVirtual(entityName: string, fieldName: string): boolean {
    const entity = this.dbService.getEntity(entityName);
    if (!entity || !entity.elements) {
      return false;
    }

    const element = entity.elements[fieldName];
    if (!element) {
      return false;
    }

    return !!(
      element.virtual ||
      element['@cds.virtual'] ||
      element['@Core.Computed']
    );
  }

  /**
   * Get all virtual field names for an entity
   */
  public getVirtualFields(entityName: string): string[] {
    const entity = this.dbService.getEntity(entityName);
    if (!entity || !entity.elements) {
      return [];
    }

    const { virtual } = this.categorizeElements(entity.elements);
    return virtual.map((v) => v.ref[0]);
  }

  /**
   * Get all non-virtual field names for an entity
   */
  public getNonVirtualFields(entityName: string): string[] {
    const entity = this.dbService.getEntity(entityName);
    if (!entity || !entity.elements) {
      return [];
    }

    const { nonVirtual } = this.categorizeElements(entity.elements);
    return nonVirtual.map((v) => v.ref[0]);
  }
}

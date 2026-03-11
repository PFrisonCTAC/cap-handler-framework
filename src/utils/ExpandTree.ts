/**
 * ExpandTree - Parse and track expand structure from requests
 * 
 * Gebaseerd op Elia CO2 ExpandTree.
 * 
 * Prevents unnecessary enrichments by checking if a path is actually expanded.
 * 
 * @example
 * ```typescript
 * // In BaseHandler.beforeAll()
 * this.expandTree = ExpandTree.fromRequest(req);
 * 
 * // Later in handler
 * if (this.expandTree.has('businessPartner')) {
 *   // Only enrich if actually requested
 *   await this.enrichBusinessPartner(rows);
 * }
 * ```
 */

export class ExpandTree {
  private paths: Set<string> = new Set();

  /**
   * Create ExpandTree from CAP request
   */
  public static fromRequest(req: any): ExpandTree {
    const tree = new ExpandTree();
    
    try {
      const columns = req?.query?.SELECT?.columns;
      if (!columns || !Array.isArray(columns)) {
        return tree;
      }

      // Parse columns to find expands
      tree.parseColumns(columns);
    } catch (error) {
      // Silent fail - tree remains empty
      console.error('Failed to parse expand tree:', error);
    }

    return tree;
  }

  /**
   * Parse columns recursively to extract expand paths
   */
  private parseColumns(columns: any[], prefix: string = ''): void {
    for (const col of columns) {
      if (!col) continue;

      // Handle expand
      if (col.expand && Array.isArray(col.expand)) {
        const ref = col.ref?.[0];
        if (ref) {
          const path = prefix ? `${prefix}.${ref}` : ref;
          this.paths.add(path);
          
          // Recurse into nested expands
          this.parseColumns(col.expand, path);
        }
      }

      // Handle ref-based columns
      if (col.ref && Array.isArray(col.ref) && col.ref.length > 1) {
        const path = prefix ? `${prefix}.${col.ref[0]}` : col.ref[0];
        this.paths.add(path);
      }
    }
  }

  /**
   * Check if a path or path array is expanded
   * 
   * @param path - Single path string or array of path segments
   * @returns true if path is expanded
   * 
   * @example
   * ```typescript
   * tree.has('businessPartner')              // true if expanded
   * tree.has(['to_Items', 'product'])        // true if to_Items.product expanded
   * tree.has('to_Items.product')             // same as above
   * ```
   */
  public has(path: string | string[]): boolean {
    const normalizedPath = Array.isArray(path) ? path.join('.') : path;
    
    // Check exact match
    if (this.paths.has(normalizedPath)) {
      return true;
    }

    // Check if any parent path matches (for nested expands)
    const segments = normalizedPath.split('.');
    for (let i = 1; i <= segments.length; i++) {
      const partialPath = segments.slice(0, i).join('.');
      if (this.paths.has(partialPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all expanded paths
   */
  public getAllPaths(): string[] {
    return Array.from(this.paths);
  }

  /**
   * Check if any expands are present
   */
  public hasAnyExpands(): boolean {
    return this.paths.size > 0;
  }

  /**
   * Clear all paths (useful for testing)
   */
  public clear(): void {
    this.paths.clear();
  }
}

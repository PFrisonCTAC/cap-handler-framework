/**
 * Query Helper - Utilities for query manipulation
 */

/**
 * Strip $count and count-ish columns from a SELECT query
 */
export function stripCount(select: any): void {
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

/**
 * Build a simple forwarding SELECT query for a remote OData V2 entity
 */
export function buildForwardQuery(
  remoteEntity: string,
  originalQuery: any,
  options?: { forbiddenColumns?: string[] }
): any {
  const cleanedQuery: any = SELECT.from(remoteEntity);
  const forbidden = new Set(options?.forbiddenColumns ?? []);

  const originalSelect = originalQuery?.SELECT;

  // Copy columns if specified
  if (Array.isArray(originalSelect?.columns) && originalSelect.columns.length > 0) {
    const cols = originalSelect.columns
      .filter((c: any) => {
        // strip count-ish columns
        const isFuncCount = typeof c?.func === 'string' && c.func.toLowerCase() === 'count';
        const isRefCount = Array.isArray(c?.ref) && (c.ref[0] === '$count' || c.ref[0] === 'count');
        if (isFuncCount || isRefCount) return false;

        const head = c?.ref?.[0];
        if (typeof head === 'string' && forbidden.has(head)) return false;

        return true;
      })
      .map((c: any) => {
        // Map column references properly (flat)
        if (c?.ref) return c.ref[0];
        return null;
      })
      .filter((c: any) => typeof c === 'string');

    const unique = Array.from(new Set(cols as string[]));
    if (unique.length > 0) cleanedQuery.SELECT.columns = unique.map((col) => ({ ref: [col] }));
  }

  // Copy where/orderBy/limit
  if (originalSelect?.where) cleanedQuery.SELECT.where = originalSelect.where;
  if (originalSelect?.orderBy) cleanedQuery.SELECT.orderBy = originalSelect.orderBy;
  if (originalSelect?.limit?.rows !== undefined) cleanedQuery.SELECT.limit = originalSelect.limit;

  stripCount(cleanedQuery.SELECT);
  return cleanedQuery;
}

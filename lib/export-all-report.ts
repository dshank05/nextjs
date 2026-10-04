/**
 * Every row a paged report would list for the current filters - for exports
 * (E-16). The paged screens used to export `data`, the page on screen: 10 rows
 * on Customer Reports, 50 on most others.
 *
 * Same endpoint, same query string; only `page` (and a larger `limit`)
 * change. The pages are walked using the `pagination` each answer carries,
 * so a route that caps `limit` below what was asked still yields every row.
 * Throws on a failed page: ExportMenu then falls back to the visible rows
 * rather than exporting a silently short file.
 *
 * Client-safe: no database import.
 */
export async function fetchAllReportRows<T = any>(
  endpoint: string,
  params: URLSearchParams | Record<string, string>,
  pick: (data: any) => T[] | undefined,
  pageSize = 500
): Promise<T[]> {
  const base = new URLSearchParams(params as any);
  base.set('limit', String(pageSize));
  const rows: T[] = [];
  // A ceiling, so a route that never reports its page count cannot loop forever.
  for (let page = 1; page <= 1000; page++) {
    base.set('page', String(page));
    const r = await fetch(`${endpoint}?${base}`);
    if (!r.ok) throw new Error('Could not load the full list');
    const data = await r.json();
    const got = pick(data) || [];
    rows.push(...got);
    const totalPages = Number(data?.pagination?.totalPages) || 1;
    if (got.length === 0 || page >= totalPages) break;
  }
  return rows;
}

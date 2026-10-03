/**
 * The one way the hooks read an API answer (BILLS_PLAN B6; it was written three
 * times with three rules). A refusal is a non-2xx status, or a 2xx carrying
 * `success: false` / `status: 'failure'`; its message is the server's, with a
 * validation `errors` list appended.
 */
export async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false || data?.status === 'failure') {
    const base = data?.message || data?.error || fallback;
    const list = Array.isArray(data?.errors) && data.errors.length ? `: ${data.errors.join(', ')}` : '';
    throw new Error(base + list);
  }
  return data;
}

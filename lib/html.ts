/**
 * Escape a value for interpolation into an HTML string.
 *
 * The print/export header built itself with `innerHTML` and dropped the
 * business details straight in - name, tagline, address, phone, email, fax,
 * GSTIN - with no escaping (S-02). Those fields are editable from Settings by
 * any signed-in user, and this app has no role checks (F-05), so a business
 * name containing `<img src=x onerror=...>` executed in the operator's session
 * every time anyone pressed Export.
 *
 * Escaping the five characters that can end an attribute or open a tag is
 * enough for text interpolated into element content or a quoted attribute. It
 * is NOT enough for an unquoted attribute, a `javascript:` URL, or anything
 * inside a `<script>` or `<style>` block - do not use it for those.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

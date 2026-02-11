/**
 * Minimal HTML escaping for untrusted strings.
 *
 * Note: Prefer Vue's default text interpolation (`{{ }}`) when possible.
 * Use this when a string must go through `v-html` or other HTML sinks.
 */
export function escapeHtml(input: unknown): string {
  const str = String(input ?? '')
  // Order matters: escape '&' first to avoid double-escaping.
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}


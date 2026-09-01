// Local uid generator (kept out of store.ts so ingest/confirm stay pure/testable).
export function uid(prefix = 'x'): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

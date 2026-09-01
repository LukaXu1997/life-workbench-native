// Pure date helpers — no React Native / storage dependency, so this module can be
// loaded under plain Node (e.g. the unit-test runner) as well as in the app.

export function todayStr(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function ymStr(d = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

// Spacing / radius / elevation / sizing tokens (modern, content-first).
// Spacing is a 4dp base grid.

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16, // page side margin (16-20dp → use lg/xl)
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// Notion-style restrained radii (small, crisp).
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  card: 12,
  xxl: 14,
  pill: 9999,
} as const;

// Standard horizontal page margin (16-20dp).
export const pageMargin = 16;
// Standard vertical gap between cards (14-16dp).
export const cardGap = 14;
// Standard scrim / dim overlay for modal sheets, pickers and overlays (M3 = 0.4).
export const scrim = 'rgba(0,0,0,0.4)';

// Elevation is intentionally near-flat (Notion is flat) — most layering is done via
// surfaceContainer color, not shadows. Shadows only for transient floating surfaces
// (FAB, menu, snackbar), kept very subtle and neutral.
export const elevation = {
  0: { elevation: 0 },
  1: {
    elevation: 1,
    shadowColor: '#0F0F0F',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  2: {
    elevation: 2,
    shadowColor: '#0F0F0F',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  3: {
    elevation: 4,
    shadowColor: '#0F0F0F',
    shadowOpacity: 0.09,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
} as const;

// Animation durations (ms). Respect Android "reduce motion" at call sites.
export const motion = {
  short: 150,
  medium: 250,
  long: 300,
} as const;

// Minimum touch target per Android guidance.
export const touchMin = 48;
// Minimum height for inputs and primary buttons.
export const controlMinH = 52;

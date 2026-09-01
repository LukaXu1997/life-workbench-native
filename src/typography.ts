// Material 3 baseline type scale.
// NOTE: React Native's <Text> already applies ONE system-font-scale pass when
// allowFontScaling is on (default). We therefore DO NOT pre-multiply here — doing
// so caused every label to be enlarged twice (the "double font scaling" bug).
export type TypeRole =
  | 'displaySmall'
  | 'headlineMedium'
  | 'titleLarge'
  | 'titleMedium'
  | 'bodyLarge'
  | 'bodyMedium'
  | 'labelLarge'
  | 'labelMedium'
  | 'labelSmall';

type Spec = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
};

const BASE: Record<TypeRole, Spec> = {
  displaySmall: { fontSize: 36, lineHeight: 44, fontWeight: '400' },
  headlineMedium: { fontSize: 28, lineHeight: 36, fontWeight: '400' },
  titleLarge: { fontSize: 22, lineHeight: 28, fontWeight: '500' },
  titleMedium: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  labelMedium: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  labelSmall: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
};

// Return the BASE spec verbatim. RN performs the single system-scale pass itself.
export function typeRole(role: TypeRole): Spec {
  return BASE[role];
}

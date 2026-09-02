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
  /** 负字距：大标题收紧字偶间距，是 Notion / Apple 的中性克制观感招牌。 */
  letterSpacing?: number;
};

const BASE: Record<TypeRole, Spec> = {
  // 大字号收紧字距：规模越大，收紧越明显（-0.5 ~ -0.1）。
  displaySmall: { fontSize: 36, lineHeight: 44, fontWeight: '400', letterSpacing: -0.5 },
  headlineMedium: { fontSize: 28, lineHeight: 36, fontWeight: '400', letterSpacing: -0.3 },
  titleLarge: { fontSize: 22, lineHeight: 28, fontWeight: '500', letterSpacing: -0.2 },
  titleMedium: { fontSize: 16, lineHeight: 24, fontWeight: '500', letterSpacing: -0.1 },
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

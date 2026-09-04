import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { M3Text } from './ui';
import { Amount } from './Amount';
import { formatMoney } from '../money';
import type { Currency } from '../types';

export interface DonutShare {
  label: string;
  amountMinor: number;
  pct: number; // 0..100
  color: string;
}

interface Props {
  shares: DonutShare[];
  total: number; // minor units (全部分类合计，含“其他”)
  cur: Currency;
  size?: number;
  thickness?: number;
  centerLabel: string;
  trackColor: string;
  centerColor?: string;
  textColor?: string;
  pctColor?: string;
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number) {
  const large = end - start > 180 ? 1 : 0;
  const p1 = polar(cx, cy, rOuter, start);
  const p2 = polar(cx, cy, rOuter, end);
  const p3 = polar(cx, cy, rInner, end);
  const p4 = polar(cx, cy, rInner, start);
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)} A ${rInner} ${rInner} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)} Z`;
}

/**
 * 分类占比环形图。单一分类占满 100% 时用整圈描边（SVG 单弧无法画满 360°）；
 * 无数据时画一圈中性 track。中心显示合计金额。
 */
export function DonutChart({
  shares,
  total,
  cur,
  size = 168,
  thickness = 20,
  centerLabel,
  trackColor,
  centerColor,
  textColor,
  pctColor,
}: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter - thickness;
  const ringR = (rOuter + rInner) / 2;

  let arcs: React.ReactNode;
  if (shares.length === 0) {
    arcs = <Circle cx={cx} cy={cy} r={ringR} fill="none" stroke={trackColor} strokeWidth={thickness} />;
  } else if (shares.length === 1) {
    arcs = <Circle cx={cx} cy={cy} r={ringR} fill="none" stroke={shares[0].color} strokeWidth={thickness} />;
  } else {
    let angle = 0;
    arcs = shares.map((s, i) => {
      const sweep = (s.pct / 100) * 360;
      const start = angle;
      const end = angle + Math.max(sweep, 0.6); // 极小占比也保留可见弧
      angle = end;
      return <Path key={i} d={arcPath(cx, cy, rOuter, rInner, start, end)} fill={s.color} />;
    });
  }

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size, position: 'relative' }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {arcs}
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <M3Text role="labelSmall" color={centerColor} numberOfLines={1}>
            {centerLabel}
          </M3Text>
          <Amount minor={total} cur={cur} role="titleMedium" weight="500" style={styles.centerAmt} />
        </View>
      </View>

      {/* 图例：色块 + 分类 + 金额 + 占比 */}
      <View style={[styles.legend, { marginTop: space_md }]}>
        {shares.length === 0 ? (
          <M3Text role="bodyMedium" color={textColor}>
            —
          </M3Text>
        ) : (
          shares.map((s, i) => (
            <View key={i} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: s.color }]} />
              <M3Text role="bodyMedium" style={styles.legendLabel} numberOfLines={1}>
                {s.label}
              </M3Text>
              <M3Text role="labelLarge" color={textColor} style={[TNUM, styles.legendAmt]} numberOfLines={1}>
                {formatMoney(s.amountMinor, cur)}
              </M3Text>
              <M3Text role="labelMedium" color={pctColor} style={[TNUM, styles.legendPct]} numberOfLines={1}>
                {s.pct}%
              </M3Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

// 与 tokens 保持一致（避免再 import tokens 造成循环）
const space_md = 12;
const TNUM = { fontVariant: ['tabular-nums' as const] };
const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  centerAmt: { marginTop: 2 },
  legend: { width: '100%', gap: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  legendLabel: { flex: 1, minWidth: 0 },
  legendAmt: { flexShrink: 0 },
  legendPct: { flexShrink: 0, width: 42, textAlign: 'right' },
});

import React, { useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect, Line, Polyline } from 'react-native-svg';
import { M3Text } from './ui';

export interface TrendPoint {
  /** x-axis label, e.g. "08" (month) or "2026" (year) */
  label: string;
  income: number; // minor units, selected currency
  expense: number; // minor units (expense − refund)
  net: number; // income − expense
}

interface Props {
  points: TrendPoint[];
  incomeColor: string;
  expenseColor: string;
  netColor: string;
  incomeLabel: string;
  expenseLabel: string;
  netLabel: string;
  gridColor?: string;
  textColor?: string;
  height?: number;
}

// Card default padding is space.lg (16) on each side, plus pageMargin (16) on the
// ScrollView. This fallback keeps the SVG sized correctly before onLayout fires.
const CARD_INSET = 16 + 16;

function LegendSwatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <View style={[styles.legendSwatch, { borderColor: color }]}>
      <View
        style={[
          styles.legendLine,
          dashed ? { borderStyle: 'dashed' as const, borderColor: color } : { backgroundColor: color },
        ]}
      />
    </View>
  );
}

/**
 * 财务趋势图（按月 / 按年）。支出以柱状呈现，收入与结余以折线呈现（结余为虚线）。
 * 坐标为「纯几何」，颜色全部由 props 传入，组件本身不感知主题。x 轴标签与图例
 * 用 RN 文本渲染，保证清晰可读且随系统字号缩放。
 */
export function TrendChart({
  points,
  incomeColor,
  expenseColor,
  netColor,
  incomeLabel,
  expenseLabel,
  netLabel,
  gridColor,
  textColor,
  height = 156,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  const [w, setW] = useState(screenW - CARD_INSET * 2);
  const txt = textColor ?? '#888';
  const gColor = gridColor ?? 'rgba(128,128,128,0.25)';

  if (points.length === 0) {
    return (
      <View style={{ height: height, alignItems: 'center', justifyContent: 'center' }}>
        <M3Text role="bodyMedium" color={txt}>
          —
        </M3Text>
      </View>
    );
  }

  const padX = 6;
  const padTop = 10;
  const padBottom = 10;
  const plotW = Math.max(1, w - padX * 2);
  const plotH = height - padTop - padBottom;
  const n = points.length;
  const slot = plotW / n;
  const barW = Math.max(4, Math.min(slot * 0.46, 22));

  // 统一纵轴范围：正区间取各序列最大值，负区间取净结余最小值（净结余可负）。
  let top = 0;
  let bottom = 0;
  for (const p of points) {
    if (p.income > top) top = p.income;
    if (p.expense > top) top = p.expense;
    if (p.net > top) top = p.net;
    if (p.net < bottom) bottom = p.net;
  }
  if (top === 0 && bottom === 0) top = 1; // 全 0 时给一个刻度，避免除零

  const total = top - bottom;
  const yScale = (v: number) =>
    bottom < 0 ? padTop + ((top - v) / total) * plotH : padTop + (1 - v / top) * plotH;

  const yZero = yScale(0);
  const cx = (i: number) => padX + slot * i + slot / 2;

  const incomePts = points.map((p, i) => `${cx(i).toFixed(2)},${yScale(p.income).toFixed(2)}`).join(' ');
  const netPts = points.map((p, i) => `${cx(i).toFixed(2)},${yScale(p.net).toFixed(2)}`).join(' ');

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => {
        const nw = e.nativeEvent.layout.width;
        if (Math.abs(nw - w) > 0.5) setW(nw);
      }}
    >
      <Svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
        {/* 0 基准线 */}
        <Line x1={padX} y1={yZero} x2={w - padX} y2={yZero} stroke={gColor} strokeWidth={1} />

        {/* 支出柱 */}
        {points.map((p, i) => {
          const yTop = yScale(p.expense);
          const h = Math.max(0, yZero - yTop);
          const x = cx(i) - barW / 2;
          return (
            <Rect key={i} x={x} y={yTop} width={barW} height={h} rx={Math.min(4, barW / 2)} fill={expenseColor} />
          );
        })}

        {/* 收入折线 */}
        <Polyline points={incomePts} fill="none" stroke={incomeColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* 结余虚线 */}
        <Polyline points={netPts} fill="none" stroke={netColor} strokeWidth={2} strokeDasharray="5,4" strokeLinejoin="round" strokeLinecap="round" />
      </Svg>

      {/* x 轴标签 */}
      <View style={[styles.axis, { marginTop: 6 }]}>
        {points.map((p, i) => (
          <M3Text key={i} role="labelSmall" color={txt} style={[TNUM, styles.axisLabel]} numberOfLines={1}>
            {p.label}
          </M3Text>
        ))}
      </View>

      {/* 图例 */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <LegendSwatch color={expenseColor} />
          <M3Text role="labelMedium" color={txt}>
            {expenseLabel}
          </M3Text>
        </View>
        <View style={styles.legendItem}>
          <LegendSwatch color={incomeColor} />
          <M3Text role="labelMedium" color={txt}>
            {incomeLabel}
          </M3Text>
        </View>
        <View style={styles.legendItem}>
          <LegendSwatch color={netColor} dashed />
          <M3Text role="labelMedium" color={txt}>
            {netLabel}
          </M3Text>
        </View>
      </View>
    </View>
  );
}

const TNUM = { fontVariant: ['tabular-nums' as const] };
const styles = StyleSheet.create({
  wrap: { width: '100%' },
  axis: { flexDirection: 'row' },
  axisLabel: { flex: 1, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 18, height: 0, borderWidth: 2, borderRadius: 2, justifyContent: 'center' },
  legendLine: { width: 16, height: 0, borderTopWidth: 2 },
});

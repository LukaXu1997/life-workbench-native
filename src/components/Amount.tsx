import React from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { AutoFitAmount, M3Text } from './ui';
import { AnimatedBalance } from './anim';
import { formatMoney } from '../money';
import { typeRole, TypeRole } from '../typography';
import type { Currency } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Amount — 统一金额显示组件
//
// 解决两类历史问题（用户反馈「数字显示不完全 / 大小不一」）：
//  1. 显示不完全：长数字在窄屏/大字体下被 numberOfLines={1} 裁切。
//     这里统一走 AutoFitAmount 的 onTextLayout 自适应缩字，绝不裁切、绝不换行。
//  2. 大小不一：各处曾混用 displaySmall / titleLarge / titleMedium 直接渲染金额，
//     字号与字重不一致。这里用 role 收敛基础字号，tabular-nums 保证字距稳定。
//
// 通过 animate 复用 AnimatedBalance（主余额等会频繁变化的数字做平滑滚动）。
// ─────────────────────────────────────────────────────────────────────────────

const MIN_FONT = 13;

// 隐私模式遮罩字符（「隐藏余额」开关开启时替代实际金额显示）
export const BALANCE_MASK = '•••••';

export function Amount({
  minor,
  cur,
  role = 'titleLarge',
  weight = '600',
  color,
  animate = false,
  maxFontSizeMultiplier = 1.2,
  style,
  accessibilityLabel,
  /** 隐私模式：以 ••••• 替代实际金额（用于「隐藏余额」开关） */
  masked = false,
}: {
  /** 整数最小单位金额（与 formatMoney 一致） */
  minor: number;
  cur: Currency;
  /** 基础字号角色，决定自适应缩字的上限 */
  role?: TypeRole;
  weight?: '400' | '500' | '600' | '700';
  color?: string;
  /** 平滑滚动到新值（用于主余额这类会频繁变化的大数字） */
  animate?: boolean;
  maxFontSizeMultiplier?: number;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  /** 隐私模式：以 ••••• 替代实际金额 */
  masked?: boolean;
}) {
  const maxFont = typeRole(role).fontSize;

  if (masked) {
    // 遮罩态不暴露任何数字（含无障碍朗读），保持 role 字号一致
    return <M3Text role={role} style={style}>{BALANCE_MASK}</M3Text>;
  }

  if (animate) {
    return (
      <AnimatedBalance
        minor={minor}
        cur={cur}
        maxFont={maxFont}
        minFont={MIN_FONT}
        color={color}
        weight={weight}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={style}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  return (
    <AutoFitAmount
      text={formatMoney(minor, cur)}
      maxFont={maxFont}
      minFont={MIN_FONT}
      color={color}
      weight={weight}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={style}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { Icon, ICONS } from '../icons';
import { M3Text, TextField } from './ui';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, CategoryDef } from '../categories';

type Props = {
  kind: 'expense' | 'income';
  value: string;
  onChange: (v: string) => void;
  showLabel?: boolean;
};

// 记账分类选择器：预设图标 chip + “自定义”入口（保留手工填的灵活性）
export default function CategoryPicker({ kind, value, onChange, showLabel = true }: Props) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const list: CategoryDef[] = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const presetLabels = list.map((c) => t(c.labelKey));
  // 用一个本地状态跟踪“是否处于自定义输入模式”，避免点自定义时把 value 清空导致
  // isCustom 立刻变 false、输入框永不出现的问题（旧实现 onChange('') 的坑）。
  const [enteringCustom, setEnteringCustom] = useState(false);
  const isCustom = enteringCustom || (value.length > 0 && !presetLabels.includes(value));

  const Chip = ({
    label,
    icon,
    selected,
    onPress,
  }: {
    label: string;
    icon: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: selected ? StyleSheet.hairlineWidth : 0,
        borderColor: selected ? theme.outline : undefined,
        backgroundColor: selected ? theme.primaryContainer : theme.surfaceContainer,
      }}
    >
      <Icon name={icon} size={18} color={selected ? theme.onPrimaryContainer : theme.onSurfaceVariant} />
      <M3Text role="labelLarge" color={selected ? theme.onPrimaryContainer : theme.onSurface}>
        {label}
      </M3Text>
    </TouchableOpacity>
  );

  return (
    <View>
      {showLabel && (
        <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
          {t('quickadd.category')}
        </M3Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {list.map((c) => {
          const label = t(c.labelKey);
          return (
            <Chip
              key={c.key}
              label={label}
              icon={c.icon}
              selected={value === label}
              onPress={() => {
                setEnteringCustom(false);
                onChange(label);
              }}
            />
          );
        })}
        <Chip
          label={t('cat.custom')}
          icon={ICONS.edit}
          selected={isCustom}
          onPress={() => {
            setEnteringCustom(true);
            if (!isCustom) onChange('');
          }}
        />
      </View>
      {isCustom && (
        <View style={{ marginTop: 8 }}>
          <TextField
            label={t('cat.custom')}
            value={value}
            onChangeText={(v) => {
              setEnteringCustom(true);
              onChange(v);
            }}
            placeholder={t('finance.categoryPlaceholder')}
          />
        </View>
      )}
    </View>
  );
}

import React, { useEffect, useState } from 'react';
import { ScrollView, View, TouchableOpacity, TextInput as RNTextInput, Pressable, Keyboard, Image, DeviceEventEmitter, Modal, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { store } from '../store';
import { useNotifyNav } from '../notify/NotifyNav';
import { usePendingCount, getNotifySettings } from '../notify/pendingStore';
import { M3Text, Button } from '../components/ui';
import { ScreenHeader, ListGroup, NavRow } from '../components/kit';
import { useBottomContentInset } from '../components/layout';
import { FadeInContent } from '../components/anim';
import { Icon, ICONS } from '../icons';
import { pageMargin, radius, space } from '../tokens';
import { DISPLAY_VERSION } from '../version';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

// ─────────────────────────────────────────────────────────────────────────────
// §三 「我的」— Notion 风格设置页
//
// 设计原则（Notion 标准）：
//   · 大量留白，分组间距 ≥ 24dp
//   · 身份区紧凑：头像 + 可编辑名称 + 副标题
//   · 分组列表：线性图标 + 标题 + 值/副标题 + chevron
//   · 无多余装饰，纯信息密度控制
//   · 每组 2–4 项，不过载
// ─────────────────────────────────────────────────────────────────────────────

/** 可选头像图标列表 — 每个对应 ICONS 中的 key */
const AVATAR_OPTIONS = [
  { key: 'me', icon: ICONS.me, label: 'Default' },
  { key: 'avatarStar', icon: ICONS.avatarStar, label: 'Star' },
  { key: 'avatarHeart', icon: ICONS.avatarHeart, label: 'Heart' },
  { key: 'avatarSun', icon: ICONS.avatarSun, label: 'Sun' },
  { key: 'avatarMoon', icon: ICONS.avatarMoon, label: 'Moon' },
  { key: 'avatarZap', icon: ICONS.avatarZap, label: 'Zap' },
];

const DEFAULT_NAME = 'Luka';

export default function MeScreen({ navigation }: any) {
  const { theme, mode } = useTheme();
  const { t, lang } = useI18n();
  const nav = useNotifyNav();
  const pendingCount = usePendingCount();
  const bottom = useBottomContentInset();

  // ── profile state ──
  const [profileName, setProfileName] = useState(DEFAULT_NAME);
  const [avatarKey, setAvatarKey] = useState('me');
  const [avatarPhoto, setAvatarPhoto] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const insets = useSafeAreaInsets();

  // ── existing state ──
  const [notifyOn, setNotifyOn] = useState(false);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [cloudReady, setCloudReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // Load profile
    store.getProfileName().then((n) => {
      if (alive) setProfileName(n || DEFAULT_NAME);
    });
    store.getProfileAvatar().then((a) => {
      if (alive) setAvatarKey(a || 'me');
    });
    store.getProfileAvatarPhoto().then((p) => {
      if (alive) setAvatarPhoto(p || null);
    });
    // Load existing settings
    getNotifySettings()
      .then((s) => alive && setNotifyOn(!!s.enabled && !s.paused))
      .catch(() => {});
    store.getFxRate().then((r) => alive && setFxRate(r));
    store.getSbConfig().then((c) => alive && setCloudReady(!!(c?.url && c?.key)));
    return () => { alive = false; };
  }, []);

  const modeLabel =
    mode === 'system' ? t('settings.modeSystem') : mode === 'dark' ? t('settings.modeDark') : t('settings.modeLight');
  const langLabel =
    lang === 'system' ? t('settings.langSystemVal') : lang === 'zh' ? t('settings.langZhVal') : t('settings.langEnVal');

  // ── name editing ──
  const startEditName = () => {
    setNameDraft(profileName);
    setEditingName(true);
  };
  const confirmName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed.length > 0 && trimmed !== profileName) {
      const next = trimmed;
      setProfileName(next);
      store.setProfileName(next);
    }
    setEditingName(false);
    Keyboard.dismiss();
  };

  // ── avatar selection ──
  const pickAvatar = (key: string) => {
    setAvatarKey(key);
    store.setProfileAvatar(key);
    // choosing an icon clears any uploaded photo
    if (avatarPhoto) {
      setAvatarPhoto(null);
      store.setProfileAvatarPhoto(null);
    }
    setPickerVisible(false);
  };

  // ── avatar photo upload ──
  const uploadPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.75,
      });
      if (result.canceled || !result.assets?.length) return;
      const src = result.assets[0].uri;
      const dest = `${FileSystem.documentDirectory}avatar.jpg`;
      // overwrite previous file (avoids orphaned files)
      await FileSystem.copyAsync({ from: src, to: dest });
      setAvatarPhoto(dest);
      store.setProfileAvatarPhoto(dest);
      setPickerVisible(false);
    } catch (e) {
      console.warn('[avatar] upload failed', e);
    }
  };

  const removePhoto = () => {
    if (avatarPhoto) {
      FileSystem.deleteAsync(avatarPhoto, { idempotent: true }).catch(() => {});
      setAvatarPhoto(null);
      store.setProfileAvatarPhoto(null);
    }
    setPickerVisible(false);
  };

  const resolvedIcon = AVATAR_OPTIONS.find((o) => o.key === avatarKey)?.icon ?? ICONS.me;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title={t('me.title')} subtitle={t('me.subtitle')} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: pageMargin, paddingTop: space.sm, paddingBottom: bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <FadeInContent>
          {/* ═══ 身份头部：可编辑名称 + 可选头像 ═══ */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.lg,
              paddingVertical: space.xl,
              marginBottom: space.xl,
            }}
          >
            {/* Avatar — tap to change */}
            <TouchableOpacity
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.7}
              accessibilityLabel={t('me.changeAvatar') || 'Change avatar'}
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.pill,
                backgroundColor: theme.primaryContainer,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {avatarPhoto ? (
                <Image
                  source={{ uri: avatarPhoto }}
                  style={{ width: 56, height: 56, borderRadius: radius.pill }}
                  resizeMode="cover"
                />
              ) : (
                <Icon name={resolvedIcon} size={28} color={theme.onPrimaryContainer} />
              )}
            </TouchableOpacity>

            {/* Name — tap to edit */}
            <View style={{ flex: 1, minWidth: 0 }}>
              {editingName ? (
                <RNTextInput
                  autoFocus
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  onSubmitEditing={confirmName}
                  onBlur={confirmName}
                  style={{
                    fontSize: 22,
                    fontWeight: '700',
                    color: theme.onSurface,
                    borderBottomWidth: 2,
                    borderBottomColor: theme.primary,
                    paddingVertical: 2,
                  }}
                  selectionColor={theme.primary}
                />
              ) : (
                <Pressable onPress={startEditName}>
                  <M3Text role="titleLarge" numberOfLines={1} style={{ lineHeight: 28 }}>
                    {profileName}
                  </M3Text>
                </Pressable>
              )}
              <M3Text role="labelMedium" color={theme.onSurfaceVariant} numberOfLines={1} style={{ marginTop: 4 }}>
                {t('me.profileHint')}
              </M3Text>
            </View>
          </View>

          {/* ═══ 记账管理 ═══ */}
          <ListGroup title={t('me.groupLedger')}>
            <NavRow
              icon={ICONS.account}
              title={t('me.accounts')}
              subtitle={t('me.accountsHint')}
              onPress={() =>
                navigation.getParent()?.navigate('财务', {
                  screen: 'FinanceHome',
                  params: { tab: 'overview' },
                })
              }
            />
            <NavRow
              icon={ICONS.budget}
              title={t('me.budget')}
              subtitle={t('me.budgetHint')}
              onPress={() =>
                navigation.getParent()?.navigate('财务', {
                  screen: 'FinanceHome',
                  params: { tab: 'budget' },
                })
              }
            />
            <NavRow
              icon={ICONS.swap}
              title={t('me.currency')}
              value={fxRate != null ? `1 MYR = ¥${fxRate}` : undefined}
              onPress={() => navigation.navigate('FinancePreferences')}
            />
            <NavRow
              icon={ICONS.fileImport}
              title={t('me.importBill')}
              subtitle={t('me.importBillHint')}
              onPress={() => nav.openImport()}
            />
          </ListGroup>

          {/* ═══ 自动化 ═══ */}
          <View style={{ height: space.xxl }} />
          <ListGroup title={t('me.groupAutomation')}>
            <NavRow
              icon={ICONS.automation}
              title={t('me.notifyRecognition')}
              value={notifyOn ? t('me.notifyOn') : t('me.notifyOff')}
              onPress={() => navigation.navigate('NotificationSettings')}
            />
            <NavRow
              icon={ICONS.pending}
              title={t('me.pendingTxn')}
              subtitle={t('me.pendingTxnHint')}
              badge={pendingCount}
              onPress={() => nav.openPending()}
            />
          </ListGroup>

          {/* ═══ 个性化 ═══ */}
          <View style={{ height: space.xxl }} />
          <ListGroup title={t('me.groupPersonal')}>
            <NavRow
              icon={ICONS.palette}
              title={t('me.appearance')}
              value={modeLabel}
              onPress={() => navigation.navigate('AppearanceSettings')}
            />
            <NavRow
              icon={ICONS.translate}
              title={t('me.language')}
              value={langLabel}
              onPress={() => navigation.navigate('LanguageSettings')}
            />
          </ListGroup>

          {/* ═══ 数据与安全 ═══ */}
          <View style={{ height: space.xxl }} />
          <ListGroup title={t('me.groupData')}>
            <NavRow
              icon={ICONS.shield}
              title={t('me.dataSecurity')}
              subtitle={t('me.dataSecurityHint')}
              value={cloudReady ? t('settings.configured') : t('settings.notConfigured')}
              onPress={() => navigation.navigate('DataAndSecurity')}
            />
            <NavRow
              icon={ICONS.wizard}
              title={t('settings.rerunOnboarding')}
              subtitle={t('settings.rerunOnboardingHint')}
              onPress={() => DeviceEventEmitter.emit('rerunOnboarding')}
            />
          </ListGroup>

          {/* ═══ 其他 ═══ */}
          <View style={{ height: space.xxl }} />
          <ListGroup title={t('me.groupOther')}>
            <NavRow
              icon={ICONS.info}
              title={t('me.about')}
              value={DISPLAY_VERSION}
              onPress={() => navigation.navigate('About')}
            />
          </ListGroup>
        </FadeInContent>
      </ScrollView>

      {/* ═══ Avatar picker — Notion-style full-screen sheet ═══
          Design intent (matches Notion mobile pattern for icon / avatar editors):
          · Full-screen page, not a floating card — gives the avatar a proper
            "stage" and lets the icon grid breathe without bottom-bar collision.
          · Top bar: title left, X close right — Notion's universal close affordance.
          · Hero block (centered): large 96dp current avatar preview with an
            overlaid remove badge. The preview IS the focal element.
          · Primary action: full-width "从相册上传图片" (Notion's filled CTA style).
          · Divider label + 3×2 icon grid (64dp tiles) — generous 24dp gaps.
          · Bottom "完成" button for explicit close (Notion never relies on
            backdrop tap for full-screen sheets).
          · Modal `animationType="slide"` = Notion's bottom-sheet motion.
          · Native Modal = above the tab bar + respects system back. */}
      <Modal
        visible={pickerVisible}
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
        statusBarTranslucent
      >
        <View
          style={{
            flex: 1,
            backgroundColor: theme.bg,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}
        >
          {/* ── Top bar (Notion-style minimal) ── */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: 56,
              paddingHorizontal: space.lg,
            }}
          >
            <M3Text role="titleMedium">{t('me.selectAvatar') || 'Select avatar'}</M3Text>
            <Pressable
              onPress={() => setPickerVisible(false)}
              accessibilityLabel="close"
              hitSlop={12}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={ICONS.close} size={20} color={theme.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* ── Centered content ── */}
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: space.xl,
              paddingVertical: space.xl,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Hero: large current avatar preview (centered) */}
            <View style={{ alignItems: 'center', marginBottom: space.xl }}>
              {avatarPhoto ? (
                <View style={{ position: 'relative' }}>
                  <Image
                    source={{ uri: avatarPhoto }}
                    style={{
                      width: 112,
                      height: 112,
                      borderRadius: 56,
                      backgroundColor: theme.surfaceContainer,
                    }}
                    resizeMode="cover"
                  />
                  <Pressable
                    onPress={removePhoto}
                    accessibilityLabel={t('me.removePhoto') || 'Remove photo'}
                    hitSlop={8}
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -2,
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: theme.error,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderColor: theme.bg,
                    }}
                  >
                    <Icon name={ICONS.close} size={14} color={theme.onError} />
                  </Pressable>
                </View>
              ) : (
                <View
                  style={{
                    width: 112,
                    height: 112,
                    borderRadius: 56,
                    backgroundColor: theme.primaryContainer,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={resolvedIcon} size={56} color={theme.onPrimaryContainer} />
                </View>
              )}
            </View>

            {/* Primary CTA: upload from album */}
            <Pressable
              onPress={uploadPhoto}
              accessibilityLabel={t('me.uploadPhoto') || 'Upload from album'}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.sm,
                backgroundColor: theme.primary,
                borderRadius: radius.md,
                paddingVertical: 14,
                paddingHorizontal: space.lg,
                alignSelf: 'stretch',
                maxWidth: 360,
                marginBottom: space.xl,
              }}
            >
              <Icon name={ICONS.image} size={20} color={theme.onPrimary} />
              <M3Text role="labelLarge" color={theme.onPrimary}>
                {t('me.uploadPhoto') || 'Upload from album'}
              </M3Text>
            </Pressable>

            {/* Divider label — */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                alignSelf: 'stretch',
                maxWidth: 360,
                marginBottom: space.lg,
              }}
            >
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.divider }} />
              <M3Text
                role="labelSmall"
                color={theme.onSurfaceVariant}
                style={{ marginHorizontal: space.md }}
              >
                {t('me.avatarOrIcon') || 'or pick an icon'}
              </M3Text>
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.divider }} />
            </View>

            {/* Icon grid — 3 × 2 of 64dp tiles */}
            <View style={{ alignItems: 'center', marginBottom: space.xxl }}>
              {[0, 1].map((row) => (
                <View
                  key={row}
                  style={{
                    flexDirection: 'row',
                    gap: space.lg,
                    marginTop: row === 0 ? 0 : space.lg,
                  }}
                >
                  {AVATAR_OPTIONS.slice(row * 3, row * 3 + 3).map((opt) => {
                    const selected = avatarKey === opt.key && !avatarPhoto;
                    return (
                      <Pressable
                        key={opt.key}
                        onPress={() => pickAvatar(opt.key)}
                        accessibilityLabel={opt.label}
                        hitSlop={4}
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: 32,
                          backgroundColor: selected ? theme.primaryContainer : theme.surfaceContainer,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: selected ? 2 : 0,
                          borderColor: theme.primary,
                        }}
                      >
                        <Icon
                          name={opt.icon}
                          size={30}
                          color={selected ? theme.onPrimaryContainer : theme.onSurfaceVariant}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Done button — Notion never relies on backdrop tap */}
            <Button
              label={t('common.done') || 'Done'}
              variant="tonal"
              onPress={() => setPickerVisible(false)}
              style={{ alignSelf: 'center', paddingHorizontal: space.xxl }}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

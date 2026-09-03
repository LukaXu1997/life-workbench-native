// Import flow (Phase 6 integration) — a Modal-based, single unified entry:
//   pick file -> preview (dedup / merge / account hints) -> commit -> report -> undo
//
// Deliberately ONE flow for every source (TNG / 支付宝 / 微信 / 工作台 JSON) —
// there are no per-platform import entries. The encrypted-PDF password dialog is
// shown only when the PDF actually needs one, and the password never leaves this
// component (it lives in a PdfPasswordSession in RAM).

import React, { useState, useRef, useCallback } from 'react';
import {
  Modal,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { Surface, M3Text, Button, Chip } from '../components/ui';
import { Icon, ICONS } from '../icons';
import { radius } from '../tokens';
import type { Account, FxSetting } from '../types';
import { formatMoney } from '../money';
import type { UnifiedPreview, UnifiedRow } from '../import/unify';
import type { ImportReport } from '../import/importService';
import { commit, undo, summarizeReport } from '../import/importService';
import { createAsyncBackend } from '../import/persistence';
import { makeAccountResolver } from '../import/accountResolver';
import { PLATFORM_DEFAULTS, type ImportSource, type ImportTemplate } from '../import/models';
import { pickStatementFile, prepareImport, type PickedFile } from '../import/runImport';
import { PdfPasswordSession } from '../import/pdfPassword';
import { store } from '../store';

type Step = 'pick' | 'preview' | 'report';

/** Map a preview row to a short transaction-class badge: 转账 / 收入 / 支出
 *  (plus 退款 / 还款 for completeness). This is only a hint — the importer does
 *  NOT auto-filter, so the user judges every row themselves. */
type TxnBadgeTone = 'primary' | 'success' | 'danger';
function txnClassBadge(r: UnifiedRow): { key: string; tone: TxnBadgeTone } {
  switch (r.txnType) {
    case 'transfer': return { key: 'importFlow.txnTransfer', tone: 'primary' };
    case 'income': return { key: 'importFlow.txnIncome', tone: 'success' };
    case 'refund': return { key: 'importFlow.txnRefund', tone: 'success' };
    case 'repayment': return { key: 'importFlow.txnRepayment', tone: 'primary' };
    case 'expense':
    default: return { key: 'importFlow.txnExpense', tone: 'danger' };
  }
}

/** Per-source binding persistence (spec §八) — a platform's ImportTemplate stores
 *  the dedicated account it is bound to, so re-imports auto-suggest it and the two
 *  platforms can never share an account (Alipay->CNY, TNG->MYR). */
function templateIdFor(src: ImportSource): string {
  return `tpl_${src}`;
}
async function loadBoundAccount(src: ImportSource): Promise<string | undefined> {
  const tpls = await store.getImportTemplates();
  return tpls.find((t) => t.source === src)?.boundAccountId;
}
async function saveBoundAccount(src: ImportSource, accountId: string | undefined): Promise<void> {
  if (!accountId) return;
  const tpls = await store.getImportTemplates();
  const idx = tpls.findIndex((t) => t.source === src);
  const base: ImportTemplate = {
    id: templateIdFor(src),
    name: src,
    source: src,
    fileKind: src === 'tng' ? 'pdf' : 'csv',
    mappings: [],
    boundAccountId: accountId,
    createdAt: Date.now(),
  };
  if (idx >= 0) tpls[idx] = { ...tpls[idx], boundAccountId: accountId };
  else tpls.push(base);
  await store.setImportTemplates(tpls);
}

export function ImportFlowModal({
  visible,
  onClose,
  accounts,
  fx,
  onImported,
}: {
  visible: boolean;
  onClose: () => void;
  accounts: Account[];
  fx: FxSetting;
  onImported?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();

  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [preview, setPreview] = useState<UnifiedPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ---- per-source account binding (spec §八) ----
  const [source, setSource] = useState<ImportSource | null>(null);
  const [boundAccountId, setBoundAccountId] = useState<string | undefined>(undefined);

  // --- encrypted PDF password dialog state ---
  const [pwdVisible, setPwdVisible] = useState(false);
  const [pwdWrong, setPwdWrong] = useState(false);
  const [pwdText, setPwdText] = useState('');
  const [pwdReveal, setPwdReveal] = useState(false);
  const [pwdAttempts, setPwdAttempts] = useState<number | null>(null);
  const pwdResolver = useRef<((v: string | null) => void) | null>(null);
  const pwdFileName = useRef<string>('');

  const closePwd = useCallback((value: string | null) => {
    setPwdVisible(false);
    setPwdText('');
    setPwdReveal(false);
    setPwdWrong(false);
    const r = pwdResolver.current;
    pwdResolver.current = null;
    if (r) r(value);
  }, []);

  /** Injected into prepareImport: shows the dialog and resolves the password. */
  const onNeedPassword = useCallback(
    (wrongPassword: boolean) =>
      new Promise<string | null>((resolve) => {
        pwdResolver.current = resolve;
        setPwdWrong(wrongPassword);
        setPwdText('');
        setPwdVisible(true);
      }),
    []
  );

  const reset = useCallback(() => {
    setStep('pick');
    setBusy(false);
    setFile(null);
    setPreview(null);
    setReport(null);
    setBatchId(null);
    setError(null);
    setSource(null);
    setBoundAccountId(undefined);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  // ------------------------------------------------------------- pick + parse
  const handlePick = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await pickStatementFile();
      if (!picked) {
        setError(t('importFlow.cancelPick'));
        return;
      }
      setFile(picked);
      pwdFileName.current = picked.name; // name only — never the full path
      const res = await prepareImport(picked, {
        onNeedPassword,
        rateScaled: fx?.rateScaled,
      });
      if (!res.ok || !res.preview) {
        setError(res.scanned ? t('importFlow.scanned') : res.reason ?? t('importFlow.empty'));
        return;
      }
      setPreview(res.preview);
      setStep('preview');
      setSource(res.source ?? null);
      if (res.source) {
        const bound = await loadBoundAccount(res.source);
        setBoundAccountId(bound);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('importFlow.empty'));
    } finally {
      setBusy(false);
    }
  }, [onNeedPassword, fx, t]);

  // ------------------------------------------------------------------- commit
  const binding = source ? { source, boundAccountId } : undefined;
  const resolver = makeAccountResolver(accounts, binding);
  const handleCommit = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const backend = createAsyncBackend();
      const res = await commit(backend, preview, {
        accountResolver: resolver,
        accounts,
        fxRateScaled: fx?.rateScaled,
      });
      // persist the per-source binding so re-imports reuse the same account (§八)
      if (source) {
        const chosen = boundAccountId ?? resolver(preview.rows[0]);
        await saveBoundAccount(source, chosen);
      }
      setReport(res.report);
      setBatchId(res.batch.id);
      setStep('report');
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('importFlow.empty'));
    } finally {
      setBusy(false);
    }
  }, [preview, accounts, fx, onImported, t, source, boundAccountId, resolver]);

  // --------------------------------------------------------------------- undo
  const handleUndo = useCallback(async () => {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    try {
      const backend = createAsyncBackend();
      await undo(backend, batchId);
      setBatchId(null);
      setReport(null);
      setPreview(null);
      setFile(null);
      setStep('pick');
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('importFlow.empty'));
    } finally {
      setBusy(false);
    }
  }, [batchId, onImported, t]);

  // ------------------------------------------------------------------- render
  const unassigned = preview
    ? preview.rows.filter((r) => !r.skipByDefault && !resolver(r)).length
    : 0;

  const bindable =
    source === 'alipay' || source === 'tng' || source === 'grab' || source === 'shopee' || source === 'lazada';
  const platformCur = bindable
    ? PLATFORM_DEFAULTS[source as 'alipay' | 'tng' | 'grab' | 'shopee' | 'lazada'].currency
    : undefined;
  const bindCandidateAccounts = platformCur
    ? accounts.filter((a) => a.currency === platformCur)
    : [];
  const selectedAccount = boundAccountId ?? (preview ? resolver(preview.rows[0]) : undefined);
  const inferredCny = !!preview?.rows.some((r) => r.source === 'alipay' && r.currencyInferredFromSource);
  const inferredMyr = !!preview?.rows.some(
    (r) =>
      (r.source === 'tng' || r.source === 'grab' || r.source === 'shopee' || r.source === 'lazada') &&
      r.currencyInferredFromSource
  );
  const currencyConflict = !!preview?.rows.some((r) => r.currencyConflict);

  return (
    <>
      <Modal visible={visible && !pwdVisible} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
          <Surface level={0} style={styles.sheet}>
            {/* header */}
            <View style={styles.header}>
              <M3Text role="titleMedium">{t('importFlow.title')}</M3Text>
              <TouchableOpacity onPress={handleClose} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                <Icon name={ICONS.close} size={20} color={theme.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {error ? (
                <View style={[styles.errorBox, { backgroundColor: theme.errorContainer }]}>
                  <M3Text role="bodyMedium" color={theme.onErrorContainer}>{error}</M3Text>
                </View>
              ) : null}

              {/* ---------------- step: pick ---------------- */}
              {step === 'pick' && (
                <View>
                  <M3Text role="labelLarge" style={{ marginBottom: 8 }}>{t('importFlow.pickTitle')}</M3Text>
                  <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 16 }}>
                    {t('importFlow.pickHint')}
                  </M3Text>
                  <Button label={t('importFlow.pickCta')} variant="tonal" onPress={handlePick} disabled={busy} />
                  {busy ? <ActivityIndicator style={{ marginTop: 16 }} color={theme.primary} /> : null}
                </View>
              )}

              {/* ---------------- step: preview ---------------- */}
              {step === 'preview' && preview && (
                <View>
                  <M3Text role="labelLarge" style={{ marginBottom: 8 }}>{t('importFlow.previewTitle')}</M3Text>
                  {file ? (
                    <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 12 }}>
                      {file.name}
                    </M3Text>
                  ) : null}
                  <M3Text role="bodyMedium" style={{ marginBottom: 4 }}>
                    {t('importFlow.rowsTotal', { n: preview.summary.total })}
                    {' · '}
                    {t('importFlow.importable', { n: preview.summary.importable })}
                  </M3Text>
                  {preview.summary.duplicates > 0 ? (
                    <M3Text role="labelMedium" color={theme.error} style={{ marginBottom: 2 }}>
                      {t('importFlow.duplicates', { n: preview.summary.duplicates })}
                    </M3Text>
                  ) : null}
                  {preview.summary.suspected > 0 ? (
                    <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 2 }}>
                      {t('importFlow.suspected', { n: preview.summary.suspected })}
                    </M3Text>
                  ) : null}
                  {preview.crossCurrencyPairs.length > 0 ? (
                    <M3Text role="labelMedium" color={theme.primary} style={{ marginBottom: 2 }}>
                      {t('importFlow.crossCurrency', { n: preview.crossCurrencyPairs.length })}
                    </M3Text>
                  ) : null}
                  {unassigned > 0 ? (
                    <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 8 }}>
                      {t('importFlow.unassigned', { n: unassigned })}
                    </M3Text>
                  ) : null}

                  {/* per-source account binding (spec §八) */}
                  {bindable && bindCandidateAccounts.length > 0 ? (
                    <View style={{ marginBottom: 12 }}>
                      <M3Text role="labelMedium" style={{ marginBottom: 4 }}>{t('importFlow.bindAccount')}</M3Text>
                      <M3Text role="bodyMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 8 }}>
                        {t('importFlow.bindAccountHint')}
                      </M3Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {bindCandidateAccounts.map((a) => {
                          const active = a.id === selectedAccount;
                          return (
                            <TouchableOpacity
                              key={a.id}
                              onPress={() => setBoundAccountId(a.id)}
                              style={[
                                styles.acctChip,
                                {
                                  borderColor: active ? theme.outline : undefined,
                                  backgroundColor: active ? theme.primaryContainer : 'transparent',
                                },
                              ]}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                            >
                              <M3Text role="labelMedium" color={active ? theme.onPrimaryContainer : theme.onSurface}>
                                {a.name}
                              </M3Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}

                  {/* currency inference / conflict (spec §九) */}
                  {inferredCny ? (
                    <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 2 }}>
                      {t('importFlow.inferredCny')}
                    </M3Text>
                  ) : null}
                  {inferredMyr ? (
                    <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 2 }}>
                      {t('importFlow.inferredMyr')}
                    </M3Text>
                  ) : null}
                  {currencyConflict ? (
                    <M3Text role="labelMedium" color={theme.error} style={{ marginBottom: 8 }}>
                      {t('importFlow.currencyConflict')}
                    </M3Text>
                  ) : null}

                  {/* row list (capped for responsiveness) */}
                  <View style={{ marginTop: 12 }}>
                    {preview.rows.slice(0, 200).map((r) => {
                      const cur = r.origCurrency ?? r.currency;
                      const amt = r.origAmountMinor ?? r.amountMinor;
                      const dim = !!r.skipByDefault;
                      const typeBadge = txnClassBadge(r);
                      const typeColor =
                        typeBadge.tone === 'primary' ? theme.primary
                        : typeBadge.tone === 'success' ? theme.success
                        : typeBadge.tone === 'danger' ? theme.danger
                        : theme.onSurfaceVariant;
                      return (
                        <View
                          key={r.id}
                          style={[
                            styles.row,
                            { borderColor: theme.divider, opacity: dim ? 0.45 : 1 },
                          ]}
                        >
                          <View style={{ flex: 1 }}>
                            <M3Text role="bodyMedium" numberOfLines={1}>
                              {r.merchant || r.category || t('common.other')}
                            </M3Text>
                            <M3Text role="labelMedium" color={theme.onSurfaceVariant}>
                              {r.date} · {r.category || t('common.other')}
                              {r.accountHint ? ` · ${r.accountHint}` : ''}
                            </M3Text>
                          </View>
                          <Chip label={t(typeBadge.key)} color={typeColor} />
                          {r.skipByDefault ? (
                            <Chip label={t('importFlow.dupBadge')} />
                          ) : null}
                          {!r.skipByDefault && r.dupStatus === 'suspected' ? (
                            <Chip label={t('importFlow.suspectBadge')} />
                          ) : null}
                          <M3Text role="bodyMedium" style={{ marginLeft: 8 }}>
                            {formatMoney(amt, cur)}
                          </M3Text>
                        </View>
                      );
                    })}
                    {preview.rows.length > 200 ? (
                      <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 8 }}>
                        … {preview.rows.length - 200} more
                      </M3Text>
                    ) : null}
                  </View>

                  <View style={styles.actions}>
                    <Button label={t('common.cancel')} variant="ghost" onPress={handleClose} disabled={busy} style={{ flex: 1 }} />
                    <Button
                      label={busy ? t('importFlow.committing') : t('importFlow.commit', { n: preview.summary.importable })}
                      variant="primary"
                      onPress={handleCommit}
                      disabled={busy || preview.summary.importable === 0}
                      style={{ flex: 2 }}
                    />
                  </View>
                </View>
              )}

              {/* ---------------- step: report ---------------- */}
              {step === 'report' && report && (
                <View>
                  <M3Text role="labelLarge" style={{ marginBottom: 8 }}>{t('importFlow.reportTitle')}</M3Text>
                  <M3Text role="bodyMedium" style={{ marginBottom: 16 }}>
                    {summarizeReport(report)}
                  </M3Text>
                  {report.modifiedTxnIds.length > 0 ? (
                    <M3Text role="labelMedium" color={theme.primary} style={{ marginBottom: 8 }}>
                      {t('importFlow.crossCurrency', { n: report.crossSourceReconciled })}
                    </M3Text>
                  ) : null}
                  <View style={styles.actions}>
                    {batchId ? (
                      <Button
                        label={busy ? t('importFlow.undoing') : t('importFlow.undoBatch')}
                        variant="danger"
                        onPress={handleUndo}
                        disabled={busy}
                        style={{ flex: 1 }}
                      />
                    ) : null}
                    <Button label={t('importFlow.done')} variant="primary" onPress={handleClose} style={{ flex: 1 }} />
                  </View>
                </View>
              )}
            </ScrollView>
          </Surface>
        </View>
      </Modal>

      {/* ---------- encrypted PDF password dialog (shown only when needed) ---------- */}
      <Modal visible={pwdVisible} transparent animationType="fade" onRequestClose={() => closePwd(null)}>
        <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
          <Surface level={0} style={{ ...styles.sheet, maxHeight: 340 }}>
            <M3Text role="titleMedium" style={{ marginBottom: 8 }}>{t('importFlow.pwdTitle')}</M3Text>
            {/* FILE NAME ONLY — never the full path */}
            <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 12 }}>
              {t('importFlow.pwdFile', { name: pwdFileName.current })}
            </M3Text>
            <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 12 }}>
              {t('importFlow.pwdHint')}
            </M3Text>
            <View style={[styles.pwdRow, { borderColor: theme.divider }]}>
              <TextInput
                value={pwdText}
                onChangeText={setPwdText}
                placeholder={t('importFlow.pwdLabel')}
                placeholderTextColor={theme.onSurfaceVariant}
                secureTextEntry={!pwdReveal}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                style={{ flex: 1, color: theme.onSurface }}
              />
              <TouchableOpacity onPress={() => setPwdReveal((v) => !v)} accessibilityRole="button">
                <M3Text role="labelMedium" color={theme.primary}>
                  {pwdReveal ? t('importFlow.pwdHide') : t('importFlow.pwdShow')}
                </M3Text>
              </TouchableOpacity>
            </View>
            {pwdWrong ? (
              <M3Text role="labelMedium" color={theme.error} style={{ marginTop: 8 }}>
                {t('importFlow.pwdWrong')}
              </M3Text>
            ) : null}
            {pwdAttempts != null ? (
              <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginTop: 4 }}>
                {t('importFlow.pwdAttempts', { n: pwdAttempts })}
              </M3Text>
            ) : null}
            <View style={styles.actions}>
              <Button label={t('common.cancel')} variant="ghost" onPress={() => closePwd(null)} style={{ flex: 1 }} />
              <Button
                label={t('importFlow.pwdUnlock')}
                variant="primary"
                onPress={() => closePwd(pwdText)}
                disabled={pwdText.length === 0}
                style={{ flex: 1 }}
              />
            </View>
          </Surface>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 16,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  acctChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  pwdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  errorBox: { padding: 12, borderRadius: radius.md, marginBottom: 12 },
});

// Re-exported so the flow can be driven from tests without the RN runtime.
export { PdfPasswordSession };

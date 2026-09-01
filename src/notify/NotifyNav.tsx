// §二 待确认 / 确认交易 / 快速记账的路由入口。
//
// 变更说明：这里原先是一个「自建 overlay 路由」（用 context 里的 view 字段 +
// 在 Tabs 上层条件渲染），因为当时没有安装 stack 导航。现在 RootStack 已经建立，
// 这三个页面成为 RootStack 的真实路由，因此本文件只保留同名 API 作为语义化门面，
// 内部改为向 RootStack 派发导航动作。
//
// 好处：
//  · Android 物理返回键 / 手势返回自动按层级回退，不再需要手写拦截
//  · 二级页天然不占用底栏，也不再需要「隐藏 tab」这种写法
//  · 所有调用点（AppTabBar / HomeScreen / FinanceScreen / PendingScreen …）零改动

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { QuickAddDraft } from './quickAdd';
import { rootGoBack, rootNavigate } from '../navigationRef';

interface NotifyNavCtx {
  openPending: () => void;
  openConfirm: (id: string) => void;
  openQuickAdd: (draft?: QuickAddDraft) => void;
  goTabs: () => void;
  /** 账单导入弹层由 FinanceScreen 承载（它持有 accounts / fx），这里只做开关 */
  importOpen: boolean;
  openImport: () => void;
  closeImport: () => void;
}

const Ctx = createContext<NotifyNavCtx>({
  openPending: () => {},
  openConfirm: () => {},
  openQuickAdd: () => {},
  goTabs: () => {},
  importOpen: false,
  openImport: () => {},
  closeImport: () => {},
});

export function useNotifyNav(): NotifyNavCtx {
  return useContext(Ctx);
}

export function NotifyNavProvider({ children }: { children: React.ReactNode }) {
  const [importOpen, setImportOpen] = useState(false);

  const openPending = useCallback(() => rootNavigate('PendingTransactions'), []);
  const openConfirm = useCallback((id: string) => rootNavigate('ConfirmTransaction', { id }), []);
  const openQuickAdd = useCallback((draft?: QuickAddDraft) => rootNavigate('QuickAdd', { draft }), []);
  const goTabs = useCallback(() => rootGoBack(), []);

  const openImport = useCallback(() => {
    // 导入入口在「我的」里，但弹层挂在财务页 → 先切到财务再打开
    rootNavigate('MainTabs', { screen: '财务' });
    setImportOpen(true);
  }, []);
  const closeImport = useCallback(() => setImportOpen(false), []);

  const value = useMemo<NotifyNavCtx>(
    () => ({ openPending, openConfirm, openQuickAdd, goTabs, importOpen, openImport, closeImport }),
    [openPending, openConfirm, openQuickAdd, goTabs, importOpen, openImport, closeImport],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

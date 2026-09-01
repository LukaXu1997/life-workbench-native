import { useSyncExternalStore } from 'react';
import { store } from './store';

// 全局「隐藏余额」开关的响应式读写。
// 默认关闭；开启后在财务页对账户余额 / 净资产 / 信用卡待还等金额做遮罩（内部仍照常计算）。
//
// 用模块级 store + useSyncExternalStore，保证在「设置」里切换开关后，已挂载的
// 财务页/账户区能立即重渲染（普通 useState+useEffect 只在挂载时读一次，切开关不会更新）。

let current = false;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  store.getHideBalances().then((v) => {
    current = v;
    emit();
  });
}

export function useHideBalances(): [boolean, (v: boolean) => void] {
  ensureLoaded();

  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };
  const getSnapshot = () => current;

  const hide = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const update = (v: boolean) => {
    current = v;
    emit();
    store.setHideBalances(v);
  };

  return [hide, update];
}

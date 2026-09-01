import { I18n } from 'i18n-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { zh } from './zh';
import { en } from './en';

const i18n = new I18n({ zh, en });
i18n.defaultLocale = 'zh';
i18n.enableFallback = true;
i18n.locale = 'zh';

export type LangMode = 'system' | 'zh' | 'en';
const KEY = 'wb_life_lang';

function systemLang(): 'zh' | 'en' {
  const tag = Localization.getLocales()[0]?.languageTag || '';
  return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
function resolve(mode: LangMode): 'zh' | 'en' {
  return mode === 'system' ? systemLang() : mode;
}

type TranslateFn = (scope: string, options?: Record<string, any>) => string;

const translate: TranslateFn = (scope, options) => i18n.t(scope, options);

type I18nCtx = {
  t: TranslateFn;
  lang: LangMode;
  resolved: 'zh' | 'en';
  setLang: (m: LangMode) => void;
};

const Ctx = createContext<I18nCtx>({
  t: translate,
  lang: 'system',
  resolved: 'zh',
  setLang: () => {},
});

export function useI18n() {
  return useContext(Ctx);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === 'system' || v === 'zh' || v === 'en') setLangState(v as LangMode);
    });
  }, []);

  const resolved = resolve(lang);
  // Apply the locale synchronously during render so that every t() call in this
  // same render pass (tab bar labels, screen content) already uses the correct
  // language. Setting it inside a useEffect would leave the first paint — and the
  // bottom tab bar, which has no other state to trigger a re-render — stuck on
  // the previous language until some unrelated re-render happens.
  i18n.locale = resolved;

  const setLang = (m: LangMode) => {
    setLangState(m);
    AsyncStorage.setItem(KEY, m);
  };

  return <Ctx.Provider value={{ t: translate, lang, resolved, setLang }}>{children}</Ctx.Provider>;
}

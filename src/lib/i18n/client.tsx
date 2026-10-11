"use client";
import { createContext, useCallback, useContext } from "react";
import { translate, type Lang } from "./index";

const LangContext = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

export function useT() {
  const lang = useLang();
  return useCallback((text: string, params?: Record<string, string | number>) => translate(lang, text, params), [lang]);
}

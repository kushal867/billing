"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { restoreForms } from "@/lib/form-stash";
import { LANG_COOKIE, translate, type Lang } from "./index";

type Value = { lang: Lang; setLang: (l: Lang) => void };
const LangContext = createContext<Value>({ lang: "en", setLang: () => undefined });

/**
 * The language lives in client state so switching is instant and never reloads the page (anything
 * typed into a form is kept). The cookie is what server-rendered text reads on the next refresh.
 */
export function LangProvider({ lang: initial, children }: { lang: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  // If the server renders with a different language (e.g. after a hard navigation), follow it.
  useEffect(() => setLangState(initial), [initial]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { restoreForms(); }, []);
  const setLang = useCallback((l: Lang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
    setLangState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext).lang;
export const useSetLang = () => useContext(LangContext).setLang;

export function useT() {
  const lang = useLang();
  return useCallback((text: string, params?: Record<string, string | number>) => translate(lang, text, params), [lang]);
}

// Контекст организации: настройки заведения, валюта, timezone, тема чека.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { settingsService } from "../api/settings";
import { useAuth } from "./AuthContext";
import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";

const OrgContext = createContext(null);

const DEFAULT_ORG = {
  name: "MARJON",
  logo: null,
  currency: "UZS",
  timezone: "Asia/Tashkent",
  vat_rate: 12,
  service_fee: 0,
  address: "",
  phone: "",
};

const STORAGE_PREFIX = "marjon_org_cache:";

function getOrgStorageKey(userId) {
  const identity = String(userId || "").trim();
  return identity ? `${STORAGE_PREFIX}${identity}` : "";
}

function readCachedOrg(userId) {
  const key = getOrgStorageKey(userId);
  if (!key) return DEFAULT_ORG;

  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    return cached ? { ...DEFAULT_ORG, ...cached } : DEFAULT_ORG;
  } catch {
    return DEFAULT_ORG;
  }
}

export function OrgProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const currentUserIdRef = useRef("");
  currentUserIdRef.current = String(user?.id || "");
  const [org, setOrg] = useState(() => readCachedOrg(user?.id));
  const [loading, setLoading] = useState(false);
  const beginRequest = useLatestRequest();

  const reload = useCallback(async () => {
    const request = beginRequest();
    const identity = String(user?.id || "");
    const storageKey = getOrgStorageKey(identity);
    if (!isAuthenticated || !storageKey) {
      setOrg(DEFAULT_ORG);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await settingsService.getCompanyProfile({ signal: request.signal });
      if (!request.isCurrent() || currentUserIdRef.current !== identity) return;
      const merged = { ...DEFAULT_ORG, ...data };
      setOrg(merged);
      localStorage.setItem(storageKey, JSON.stringify(merged));
    } catch (err) {
      if (!request.isCurrent() || currentUserIdRef.current !== identity || isAbortError(err)) return;
      console.warn("companies/me не найден:", err.response?.status);
      setOrg(null);
    } finally {
      if (request.isCurrent() && currentUserIdRef.current === identity) setLoading(false);
    }
  }, [beginRequest, isAuthenticated, user?.id]);

  useEffect(() => {
    setOrg(readCachedOrg(user?.id));
    reload();
  }, [reload, user?.id]);

  const update = useCallback(async (patch) => {
    const identity = String(user?.id || "");
    const storageKey = getOrgStorageKey(identity);
    const { data } = await settingsService.updateCompanyProfile(patch);
    if (!storageKey || currentUserIdRef.current !== identity) return data;
    const merged = { ...org, ...data };
    setOrg(merged);
    localStorage.setItem(storageKey, JSON.stringify(merged));
    return merged;
  }, [org, user?.id]);

  const value = useMemo(() => ({ org, loading, reload, update }), [org, loading, reload, update]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside <OrgProvider>");
  return ctx;
}

// Для страниц, которым организация нужна лишь «по возможности» (обновить данные после сохранения).
export function useOrgOptional() {
  return useContext(OrgContext);
}

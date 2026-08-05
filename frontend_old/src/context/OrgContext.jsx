// Контекст организации: настройки заведения, валюта, timezone, тема чека.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

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

const STORAGE_KEY = "marjon_org_cache";

export function OrgProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const [org, setOrg] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return cached || DEFAULT_ORG;
    } catch {
      return DEFAULT_ORG;
    }
  });
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const { data } = await api.get("/companies/me");
      const merged = { ...DEFAULT_ORG, ...data };
      setOrg(merged);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.warn("companies/me не найден:", err.response?.status);
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    reload();
  }, [reload, user?.id]);

  const update = useCallback(async (patch) => {
    const { data } = await api.patch("/companies/me", patch);
    const merged = { ...org, ...data };
    setOrg(merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  }, [org]);

  const value = useMemo(() => ({ org, loading, reload, update }), [org, loading, reload, update]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside <OrgProvider>");
  return ctx;
}

// Глобальный контекст авторизации.
// Содержит текущего user, роль, методы login/logout, статус загрузки.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, isAuthenticated, login as apiLogin, loginByPhone as apiLoginByPhone, loginByPin as apiLoginByPin, logout as apiLogout } from "../api/client";
import { getRole, ROLE_HOME } from "../utils/permissions";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    if (!isAuthenticated()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      return data;
    } catch (e) {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const loginEmail = useCallback(async (email, password) => {
    setError(null);
    try {
      await apiLogin(email, password);
      return await loadProfile();
    } catch (e) {
      setError(e?.response?.data?.detail || "Ошибка входа");
      throw e;
    }
  }, [loadProfile]);

  const loginPhone = useCallback(async (phone, password) => {
    setError(null);
    try {
      await apiLoginByPhone(phone, password);
      return await loadProfile();
    } catch (e) {
      setError(e?.response?.data?.detail || "Ошибка входа");
      throw e;
    }
  }, [loadProfile]);

  const loginPin = useCallback(async (employeeId, pin) => {
    setError(null);
    try {
      await apiLoginByPin(employeeId, pin);
      return await loadProfile();
    } catch (e) {
      setError(e?.response?.data?.detail || "Неверный PIN");
      throw e;
    }
  }, [loadProfile]);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    role: getRole(user),
    isAuthenticated: Boolean(user),
    loading,
    error,
    loginEmail,
    loginPhone,
    loginPin,
    logout,
    reload: loadProfile,
    homeFor: (u) => ROLE_HOME[getRole(u || user)] || "/",
  }), [user, loading, error, loginEmail, loginPhone, loginPin, logout, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

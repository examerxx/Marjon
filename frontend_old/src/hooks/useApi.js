// Универсальный хук для GET-запросов с loading/error/data,
// поддержкой ручного refetch и зависимостями.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export function useApi(url, options = {}) {
  const { params, enabled = true, initialData = null, deps = [] } = options;
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(null);

  const execute = useCallback(async () => {
    if (!enabled || !url) return;
    if (cancelRef.current) cancelRef.current.abort();
    const controller = new AbortController();
    cancelRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const response = await api.get(url, { params, signal: controller.signal });
      setData(response.data);
      return response.data;
    } catch (e) {
      if (e.name !== "CanceledError" && e.name !== "AbortError") {
        setError(e);
      }
    } finally {
      setLoading(false);
    }
  }, [url, enabled, JSON.stringify(params || {}), ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    execute();
    return () => {
      if (cancelRef.current) cancelRef.current.abort();
    };
  }, [execute]);

  return { data, error, loading, refetch: execute, setData };
}

// Хук для мутаций (POST/PATCH/DELETE).
export function useMutation(requestFn) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await requestFn(...args);
      return result;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [requestFn]);

  return { mutate, loading, error };
}

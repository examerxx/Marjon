import axios from "axios";

export const ADMIN_API_BASE_URL = import.meta.env.VITE_ADMIN_API_URL || "http://127.0.0.1:8000/api/v1/admin";

export const adminApi = axios.create({
  baseURL: ADMIN_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_access_token") || localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("admin_access_token");
      localStorage.removeItem("admin_refresh_token");
    }
    return Promise.reject(error);
  },
);

export async function adminLogin(email, password) {
  const { data } = await adminApi.post("/auth/login", { email, password });
  localStorage.setItem("admin_access_token", data.access_token);
  localStorage.setItem("admin_refresh_token", data.refresh_token);
  return data;
}

export function adminLogout() {
  localStorage.removeItem("admin_access_token");
  localStorage.removeItem("admin_refresh_token");
}

export function isAdminAuthenticated() {
  return Boolean(localStorage.getItem("admin_access_token") || localStorage.getItem("access_token"));
}

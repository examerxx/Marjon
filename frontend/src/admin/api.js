import axios from "axios";

export const ADMIN_API_BASE_URL = import.meta.env.VITE_ADMIN_API_URL || "http://127.0.0.1:8000/api/v1";
const LOCAL_ADMIN_PHONE = "+998900078779";
const LOCAL_ADMIN_PASSWORD = "102938";

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

function normalizeAdminPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 9) return `+998${digits}`;
  return digits.startsWith("998") ? `+${digits}` : `+${digits}`;
}

function isLocalAdminHost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function isLocalAdminCredential(phone, password) {
  return isLocalAdminHost() && phone === LOCAL_ADMIN_PHONE && String(password) === LOCAL_ADMIN_PASSWORD;
}

export async function adminLogin(phone, password) {
  const normalizedPhone = normalizeAdminPhone(phone);

  try {
    const { data } = await adminApi.post("/auth/login", { phone: normalizedPhone, password });
    localStorage.setItem("admin_access_token", data.access_token);
    localStorage.setItem("admin_refresh_token", data.refresh_token);
    localStorage.removeItem("admin_local_login");
    return data;
  } catch (error) {
    if (isLocalAdminCredential(normalizedPhone, password)) {
      localStorage.removeItem("admin_local_login");
    }
    throw error;
  }
}

export function adminLogout() {
  localStorage.removeItem("admin_access_token");
  localStorage.removeItem("admin_refresh_token");
  localStorage.removeItem("admin_local_login");
}

export function isAdminAuthenticated() {
  return Boolean(
    localStorage.getItem("admin_access_token")
      || localStorage.getItem("access_token"),
  );
}

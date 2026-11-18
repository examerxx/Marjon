import { api } from "./client";

// Столы заведения с готовыми токенами для QR (только владелец).
export async function fetchQrTables() {
  const { data } = await api.get("/qr-menu/tables");
  return data;
}

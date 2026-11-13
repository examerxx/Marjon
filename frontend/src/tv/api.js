// Публичный клиент ТВ-экрана посетителей.
//
// Ни логина, ни токена: телевизор в зале не должен уметь ничего, кроме
// чтения номеров. Филиал берём из адреса (?branch=<uuid>) и запоминаем на
// устройстве, чтобы после перезагрузки телевизора ссылку не искать заново.
export const TV_API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

const BRANCH_KEY = "marjon_tv_branch";

export function getTvBranchId() {
  let fromUrl = "";
  try {
    const params = new URLSearchParams(window.location.search);
    fromUrl = (params.get("branch") || params.get("b") || "").trim();
  } catch {
    fromUrl = "";
  }
  if (fromUrl) {
    try {
      localStorage.setItem(BRANCH_KEY, fromUrl);
    } catch {
      // Приватный режим — просто работаем без запоминания
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(BRANCH_KEY) || "";
  } catch {
    return "";
  }
}

export async function fetchDisplayBoard(branchId, signal) {
  const url = `${TV_API_BASE_URL}/kitchen/display?branch_id=${encodeURIComponent(branchId)}`;
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Display request failed: ${response.status}`);
  }
  return response.json();
}

import { getActiveBranch, returnToNetwork, clearBranchSession } from "../auth/branchSession";
import { useAuth } from "../hooks/useAuth";
import { t } from "../i18n/t";

// Плашка «вы работаете в филиале»: видна во всей админке, пока активна сессия
// филиала. Для владельца (пришёл из сети по кнопке «Войти») — «Вернуться к
// сети» восстанавливает его токен; для прямого входа филиала — «Выйти».
export default function BranchSessionBanner() {
  const { logout } = useAuth();
  const active = getActiveBranch();
  if (!active?.id) return null;

  const exit = () => {
    clearBranchSession();
    logout();
  };

  return (
    <div
      className="branch-session-banner"
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "8px 16px",
        background: "var(--color-brand)",
        color: "#fff",
        fontSize: 14,
        fontWeight: 500,
      }}
    >
      <span>
       {t("components.branchsessionbanner.vy_v_filiale")}{active.name || "—"}»
      </span>
      {active.canReturn ? (
        <button
          type="button"
          onClick={returnToNetwork}
          style={{ background: "#fff", color: "var(--color-brand-dark)", border: "none", borderRadius: 8, padding: "4px 12px", fontWeight: 600, cursor: "pointer" }}
        >
         {t("components.branchsessionbanner.vernutsya_k_seti")}
        </button>
      ) : (
        <button
          type="button"
          onClick={exit}
          style={{ background: "#fff", color: "var(--color-brand-dark)", border: "none", borderRadius: 8, padding: "4px 12px", fontWeight: 600, cursor: "pointer" }}
        >
         {t("components.branchsessionbanner.vyyti")}
        </button>
      )}
    </div>
  );
}

import Icon from "../Icon";
import { t } from "../../i18n/t";

// Плашка баланса в topbar-actions (OWNER). Открывает модалку оплаты.
// Вынесено из Topbar.jsx (FE-07B). Разметка и классы сохранены 1:1.
export default function TopbarBalancePill({ balance, balanceLoading, balanceError, onOpenPayment }) {
  return (
    <div className="topbar-balance-pill" aria-label={balanceError ? `${t("topbar.balance_unavailable")}: ${balanceError}` : `${t("topbar.balance")} ${Number(balance || 0).toLocaleString("ru-RU")} UZS`}>
      <span className="topbar-balance-amount">{balanceLoading ? "..." : balanceError ? "Недоступно" : `${Number(balance).toLocaleString("ru-RU")} UZS`}</span>
      <button
        className="topbar-pay-button"
        type="button"
        aria-label={t("components.topbar.topbarbalancepill.balans")}
        onClick={(event) => onOpenPayment(event.currentTarget)}
      >
        <Icon name="bi-wallet2" size={18} />
        <span>{t("components.topbar.topbarbalancepill.balans")}</span>
      </button>
    </div>
  );
}

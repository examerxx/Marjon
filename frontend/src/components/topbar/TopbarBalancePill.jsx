import Icon from "../Icon";

// Плашка баланса в topbar-actions (OWNER). Открывает модалку оплаты.
// Вынесено из Topbar.jsx (FE-07B). Разметка и классы сохранены 1:1.
export default function TopbarBalancePill({ balance, balanceLoading, balanceError, onOpenPayment }) {
  return (
    <div className="topbar-balance-pill" aria-label={balanceError ? `Баланс недоступен: ${balanceError}` : `Баланс ${Number(balance || 0).toLocaleString("ru-RU")} UZS`}>
      <span className="topbar-balance-amount">{balanceLoading ? "..." : balanceError ? "Недоступно" : `${Number(balance).toLocaleString("ru-RU")} UZS`}</span>
      <button
        className="topbar-pay-button"
        type="button"
        aria-label="Баланс"
        onClick={(event) => onOpenPayment(event.currentTarget)}
      >
        <Icon name="bi-wallet2" size={18} />
        <span>Баланс</span>
      </button>
    </div>
  );
}

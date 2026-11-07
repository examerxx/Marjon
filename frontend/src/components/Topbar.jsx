import BackButton from "./BackButton";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import TopbarRateWidget from "./topbar/TopbarRateWidget";
import TopbarThemeToggle from "./topbar/TopbarThemeToggle";
import TopbarNotifications from "./topbar/TopbarNotifications";
import TopbarBalancePill from "./topbar/TopbarBalancePill";
import TopbarPaymentModal from "./topbar/TopbarPaymentModal";
import { useTopbarBalance } from "./topbar/useTopbarBalance";
import DarkShellWaves from "./preview/DarkShellWaves";

// Оркестратор верхней панели OWNER (FE-07B). Слева — навигация назад и выбор
// даты; справа — независимые виджеты (курсы, уведомления, баланс). Загрузка
// данных идёт через сервисный слой (FE-05), безопасность запросов сохранена (FE-06).
export default function Topbar({
  title,
  selectedDate,
  floatingShell,
  onToggleMenu,
}) {
  const balance = useTopbarBalance();
  const [balanceHost, setBalanceHost] = useState(null);
  useEffect(() => {
    const sync = () => setBalanceHost(document.getElementById("preview-profile-balance"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header className="dashboard-topbar">
        <DarkShellWaves variant="topbar" />
        <div className="topbar-left">
          <span className="topbar-back-slot">
            <BackButton className="topbar-custom-back" iconName="bi-chevron-left" />
          </span>
        </div>
        <div className="topbar-actions">
          <TopbarRateWidget />
          <TopbarThemeToggle />
          <TopbarNotifications />
          <div id="preview-topbar-profile" />
          {balanceHost && createPortal(<TopbarBalancePill
            balance={balance.balance}
            balanceLoading={balance.balanceLoading}
            balanceError={balance.balanceError}
            onOpenPayment={() => balance.openPayment(document.querySelector("#preview-topbar-profile .sidebar-user"))}
          />, balanceHost)}
        </div>
      </header>
      <TopbarPaymentModal
        paymentOpen={balance.paymentOpen}
        returnFocusRef={balance.paymentTriggerRef}
        paymentStep={balance.paymentStep}
        paymentMethod={balance.paymentMethod}
        setPaymentMethod={balance.setPaymentMethod}
        openPaymentWindow={balance.openPaymentWindow}
        openConfirmation={balance.openConfirmation}
        backToPaymentMethods={balance.backToPaymentMethods}
        backToCardDetails={balance.backToCardDetails}
        closePayment={balance.closePayment}
        cardAmount={balance.cardAmount}
        setCardAmount={balance.setCardAmount}
        sanitizeAmountInput={balance.sanitizeAmountInput}
        formatAmountDisplay={balance.formatAmountDisplay}
        cardNumber={balance.cardNumber}
        setCardNumber={balance.setCardNumber}
        sanitizeCardNumberInput={balance.sanitizeCardNumberInput}
        formatCardNumberDisplay={balance.formatCardNumberDisplay}
        cardExpiry={balance.cardExpiry}
        setCardExpiry={balance.setCardExpiry}
        sanitizeExpiryInput={balance.sanitizeExpiryInput}
        formatExpiryDisplay={balance.formatExpiryDisplay}
        offerAccepted={balance.offerAccepted}
        setOfferAccepted={balance.setOfferAccepted}
        amountLeadingZero={balance.amountLeadingZero}
        cardNumberValid={balance.cardNumberValid}
        expiryInvalid={balance.expiryInvalid}
        cardValid={balance.cardValid}
      />
    </>
  );
}

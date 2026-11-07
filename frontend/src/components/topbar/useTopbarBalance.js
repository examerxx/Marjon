import { useEffect, useRef, useState } from "react";
import { settingsService } from "../../api/settings";

function digitsOnly(value, maxLength) {
  return String(value ?? "").replace(/\D/g, "").slice(0, maxLength);
}

export function sanitizeAmountInput(value) {
  return digitsOnly(value, 15);
}

export function formatAmountDisplay(value) {
  return String(value ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function sanitizeCardNumberInput(value) {
  return digitsOnly(value, 16);
}

export function formatCardNumberDisplay(value) {
  return String(value ?? "").replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function sanitizeExpiryInput(value) {
  return digitsOnly(value, 4);
}

export function formatExpiryDisplay(value) {
  const digits = String(value ?? "");
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function isAmountValid(value) {
  return /^[1-9]\d*$/.test(String(value ?? ""));
}

export function hasAmountLeadingZero(value) {
  return /^0/.test(String(value ?? ""));
}

export function isCardNumberValid(value) {
  const digits = String(value ?? "");
  if (!/^\d{16}$/.test(digits)) return false;

  const checksum = digits.split("").reduce((sum, character, index) => {
    let digit = Number(character);
    if (index % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    return sum + digit;
  }, 0);

  return checksum % 10 === 0;
}

export function isExpiryValid(value) {
  const digits = String(value ?? "");
  if (!/^\d{4}$/.test(digits)) return false;
  const month = Number(digits.slice(0, 2));
  return month >= 1 && month <= 12;
}

export function isExpiryMonthInvalid(value) {
  if (String(value ?? "").length < 2) return false;
  const month = Number(String(value).slice(0, 2));
  return month < 1 || month > 12;
}

// Состояние и логика баланса/оплаты Topbar (OWNER).
// Вынесено из Topbar.jsx (FE-07B) как хук: владеет состоянием, загружает баланс
// через settingsService (FE-05). Биллинг остаётся DEFERRED: локальный трёхшаговый
// предпросмотр не отправляет платёжные данные и не меняет баланс.
export function useTopbarBalance() {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paymentTriggerRef = useRef(null);
  const [paymentMethod, setPaymentMethod] = useState("uzcard");
  const [paymentStep, setPaymentStep] = useState("method");
  const [cardAmount, setCardAmount] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [offerAccepted, setOfferAccepted] = useState(false);
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState("");

  useEffect(() => {
    setBalanceError("");
    settingsService.getBillingBalance()
      .then(({ data }) => {
        const value = Number(data?.balance ?? data?.amount);
        if (Number.isFinite(value)) {
          setBalance(value);
        } else {
          setBalance(null);
          setBalanceError("Backend не вернул баланс.");
        }
      })
      .catch((err) => {
        setBalance(null);
        setBalanceError(err.response?.data?.detail || "Баланс недоступен.");
      })
      .finally(() => setBalanceLoading(false));
  }, []);

  function openPayment(trigger) {
    paymentTriggerRef.current = trigger;
    setPaymentStep("method");
    setPaymentOpen(true);
  }

  function closePayment() {
    setPaymentOpen(false);
    setPaymentStep("method");
    setCardAmount("");
    setCardNumber("");
    setCardExpiry("");
    setOfferAccepted(false);
  }

  function openPaymentWindow() {
    setPaymentStep("card");
  }

  function backToPaymentMethods() {
    setPaymentStep("method");
  }

  function backToCardDetails() {
    setPaymentStep("card");
  }

  const amountValid = isAmountValid(cardAmount);
  const amountLeadingZero = hasAmountLeadingZero(cardAmount);
  const cardNumberValid = isCardNumberValid(cardNumber);
  const expiryValid = isExpiryValid(cardExpiry);
  const expiryInvalid = isExpiryMonthInvalid(cardExpiry);
  const cardValid = Boolean(paymentMethod)
    && amountValid
    && cardNumberValid
    && expiryValid
    && offerAccepted;

  function openConfirmation() {
    if (cardValid) setPaymentStep("confirm");
  }

  return {
    balance,
    balanceLoading,
    balanceError,
    paymentOpen,
    setPaymentOpen,
    paymentTriggerRef,
    paymentMethod,
    setPaymentMethod,
    paymentStep,
    cardAmount,
    setCardAmount,
    cardNumber,
    setCardNumber,
    cardExpiry,
    setCardExpiry,
    offerAccepted,
    setOfferAccepted,
    amountValid,
    amountLeadingZero,
    cardNumberValid,
    expiryValid,
    expiryInvalid,
    cardValid,
    openPayment,
    openPaymentWindow,
    openConfirmation,
    backToPaymentMethods,
    backToCardDetails,
    closePayment,
    sanitizeAmountInput,
    formatAmountDisplay,
    sanitizeCardNumberInput,
    formatCardNumberDisplay,
    sanitizeExpiryInput,
    formatExpiryDisplay,
  };
}

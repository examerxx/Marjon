import { createPortal, flushSync } from "react-dom";
import { useEffect, useRef, useState } from "react";
import uzcardLogo from "../../assets/paylogos/uzcard-humo.jpg";
import visaLogo from "../../assets/paylogos/visa-mastercard.jpg";
import marjonBalanceMark from "../../assets/brand/marjon-balance-mark.svg";
import Icon from "../Icon";
import { useAnchoredDialogMotion } from "../../hooks/useAnchoredDialogMotion";

const STEP_TRANSITION_MS = 200;
const STEP_ORDER = { method: 1, card: 2, confirm: 3, success: 3 };
const STEP_LABELS = ["Способ оплаты", "Данные карты", "Подтверждение"];

function displayIndexToRawIndex(value, displayIndex) {
  return (value.slice(0, Math.max(0, displayIndex)).match(/\d/g) || []).length;
}

function rawIndexToDisplayIndex(value, rawIndex) {
  if (rawIndex <= 0) return 0;

  let digitsSeen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) digitsSeen += 1;
    if (digitsSeen === rawIndex) {
      let nextIndex = index + 1;
      while (value[nextIndex] === " ") nextIndex += 1;
      return nextIndex;
    }
  }

  return value.length;
}

function rawCaretAfterEdit(previousValue, nextValue) {
  let prefixLength = 0;
  while (
    prefixLength < previousValue.length
    && prefixLength < nextValue.length
    && previousValue[prefixLength] === nextValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousValue.length - prefixLength
    && suffixLength < nextValue.length - prefixLength
    && previousValue[previousValue.length - 1 - suffixLength] === nextValue[nextValue.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return prefixLength + Math.max(0, nextValue.length - prefixLength - suffixLength);
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function StepIndicator({ step, activeStep, onNavigate, backLabel, testId }) {
  const isComplete = step < activeStep;
  const isCurrent = step === activeStep;

  if (isComplete) {
    return (
      <button
        className="balance-card-step__number is-complete"
        type="button"
        aria-label={backLabel}
        onClick={onNavigate}
        data-testid={testId}
      >
        {step}
      </button>
    );
  }

  return (
    <span
      className={`balance-card-step__number ${isCurrent ? "is-current" : ""}`}
      aria-current={isCurrent ? "step" : undefined}
      data-testid={testId}
    >
      {step}
    </span>
  );
}

function PaymentStepper({ activeStep, onBackToMethods, onBackToCardDetails }) {
  return (
    <div className="balance-card-step__progress" aria-label={`Шаг ${activeStep} из 3: ${STEP_LABELS[activeStep - 1]}`}>
      <div className="balance-card-step__progress-item">
        <StepIndicator
          step={1}
          activeStep={activeStep}
          onNavigate={onBackToMethods}
          backLabel="Вернуться к выбору способа оплаты"
          testId="balance-step-one"
        />
        <strong className={activeStep === 1 ? "is-active" : activeStep > 1 ? "is-complete" : ""}>Способ оплаты</strong>
      </div>
      <i className={activeStep > 1 ? "is-filled" : ""} data-testid="balance-step-connector-one" />
      <div className="balance-card-step__progress-item">
        <StepIndicator
          step={2}
          activeStep={activeStep}
          onNavigate={onBackToCardDetails}
          backLabel="Вернуться к данным карты"
          testId="balance-step-two"
        />
        <strong className={activeStep === 2 ? "is-active" : activeStep > 2 ? "is-complete" : ""}>Данные карты</strong>
      </div>
      <i className={activeStep > 2 ? "is-filled" : ""} data-testid="balance-step-connector-two" />
      <div className="balance-card-step__progress-item">
        <StepIndicator step={3} activeStep={activeStep} testId="balance-step-three" />
        <strong className={activeStep === 3 ? "is-active" : ""}>Подтверждение</strong>
      </div>
    </div>
  );
}

// Модалка оплаты баланса (OWNER) — сиблинг <header>, position:fixed оверлей.
// Биллинг DEFERRED: UI-предпросмотр полей доступен, но процессинг остаётся
// отключённым до подключения платёжного процессора.
export default function TopbarPaymentModal({
  paymentOpen,
  returnFocusRef,
  paymentStep,
  paymentMethod,
  setPaymentMethod,
  openPaymentWindow,
  openConfirmation,
  backToPaymentMethods,
  backToCardDetails,
  closePayment,
  cardAmount,
  setCardAmount,
  sanitizeAmountInput,
  formatAmountDisplay,
  cardNumber,
  setCardNumber,
  sanitizeCardNumberInput,
  formatCardNumberDisplay,
  cardExpiry,
  setCardExpiry,
  sanitizeExpiryInput,
  formatExpiryDisplay,
  offerAccepted,
  setOfferAccepted,
  amountLeadingZero,
  cardNumberValid,
  expiryInvalid,
  cardValid,
}) {
  const [renderedStep, setRenderedStep] = useState(paymentStep);
  const [stepMotion, setStepMotion] = useState("");
  const swapTimerRef = useRef(null);
  const enterTimerRef = useRef(null);
  const cardInputRef = useRef(null);
  const cardDisplaySelectionRef = useRef({ start: 0, end: 0 });
  const {
    dialogRef,
    motionClassName,
    motionStyle,
    requestClose,
    handleAnimationEnd,
  } = useAnchoredDialogMotion({
    isOpen: paymentOpen,
    onClose: closePayment,
    motionMode: "centered",
    returnFocusRef,
  });

  const paymentMethodLabel = paymentMethod === "visa" ? "Visa / Mastercard" : "UzCard / Humo";
  const paymentMethodLogo = paymentMethod === "visa" ? visaLogo : uzcardLogo;
  const maskedCardNumber = `•••• •••• •••• ${cardNumber.slice(-4)}`;
  const amountHasError = amountLeadingZero;
  const cardHasError = cardNumber.length === 16 && !cardNumberValid;
  const expiryHasError = expiryInvalid;
  const stepMotionClassName = stepMotion ? `balance-step-motion balance-step-motion--${stepMotion}` : "balance-step-motion";

  const restoreCardSelection = (selection, fallbackInput = null) => {
    const input = cardInputRef.current || fallbackInput;
    if (!input || !selection) return;
    const displayValue = input.value;
    const displaySelectionStart = rawIndexToDisplayIndex(displayValue, selection.start);
    const displaySelectionEnd = rawIndexToDisplayIndex(displayValue, selection.end);
    input.setSelectionRange(displaySelectionStart, displaySelectionEnd);
    cardDisplaySelectionRef.current = {
      start: input.selectionStart ?? 0,
      end: input.selectionEnd ?? input.selectionStart ?? 0,
    };
  };

  const updateCardNumber = (nextRaw, selectionStart, selectionEnd = selectionStart) => {
    const input = cardInputRef.current;
    const sanitized = sanitizeCardNumberInput(nextRaw);
    const selection = {
      start: Math.min(selectionStart, sanitized.length),
      end: Math.min(selectionEnd, sanitized.length),
    };
    flushSync(() => setCardNumber(sanitized));
    restoreCardSelection(selection, input);
  };

  const handleCardNumberChange = (event) => {
    const displayValue = event.target.value;
    const selectionStart = event.target.selectionStart ?? displayValue.length;
    const selectionEnd = event.target.selectionEnd ?? selectionStart;
    const rawSelectionStart = displayIndexToRawIndex(displayValue, selectionStart);
    const nextRaw = sanitizeCardNumberInput(displayValue);
    const inputType = event.nativeEvent?.inputType;

    if (nextRaw !== cardNumber) {
      updateCardNumber(nextRaw, rawCaretAfterEdit(cardNumber, nextRaw));
      return;
    }

    if (nextRaw === cardNumber && selectionStart === selectionEnd && inputType === "deleteContentBackward" && rawSelectionStart > 0) {
      updateCardNumber(
        `${cardNumber.slice(0, rawSelectionStart - 1)}${cardNumber.slice(rawSelectionStart)}`,
        rawSelectionStart - 1,
      );
      return;
    }

    if (nextRaw === cardNumber && selectionStart === selectionEnd && inputType === "deleteContentForward" && rawSelectionStart < cardNumber.length) {
      updateCardNumber(
        `${cardNumber.slice(0, rawSelectionStart)}${cardNumber.slice(rawSelectionStart + 1)}`,
        rawSelectionStart,
      );
      return;
    }

    updateCardNumber(nextRaw, rawSelectionStart);
  };

  const rememberCardSelection = (event) => {
    cardDisplaySelectionRef.current = {
      start: event.currentTarget.selectionStart ?? 0,
      end: event.currentTarget.selectionEnd ?? event.currentTarget.selectionStart ?? 0,
    };
  };

  const replaceCardSelection = (input, insertedValue) => {
    const rawSelectionStart = displayIndexToRawIndex(input.value, input.selectionStart ?? 0);
    const rawSelectionEnd = displayIndexToRawIndex(input.value, input.selectionEnd ?? rawSelectionStart);
    const availableDigits = 16 - (cardNumber.length - (rawSelectionEnd - rawSelectionStart));
    const insertedDigits = sanitizeCardNumberInput(insertedValue).slice(0, Math.max(0, availableDigits));
    if (!insertedDigits && rawSelectionStart === rawSelectionEnd) return;

    const nextRaw = `${cardNumber.slice(0, rawSelectionStart)}${insertedDigits}${cardNumber.slice(rawSelectionEnd)}`;
    updateCardNumber(nextRaw, rawSelectionStart + insertedDigits.length);
  };

  const deleteCardSelection = (input, direction) => {
    const rawSelectionStart = displayIndexToRawIndex(input.value, input.selectionStart ?? 0);
    const rawSelectionEnd = displayIndexToRawIndex(input.value, input.selectionEnd ?? rawSelectionStart);

    if (rawSelectionStart !== rawSelectionEnd) {
      updateCardNumber(
        `${cardNumber.slice(0, rawSelectionStart)}${cardNumber.slice(rawSelectionEnd)}`,
        rawSelectionStart,
      );
      return;
    }

    if (direction === "backward" && rawSelectionStart > 0) {
      updateCardNumber(
        `${cardNumber.slice(0, rawSelectionStart - 1)}${cardNumber.slice(rawSelectionStart)}`,
        rawSelectionStart - 1,
      );
      return;
    }

    if (direction === "forward" && rawSelectionStart < cardNumber.length) {
      updateCardNumber(
        `${cardNumber.slice(0, rawSelectionStart)}${cardNumber.slice(rawSelectionStart + 1)}`,
        rawSelectionStart,
      );
    }
  };

  const handleCardNumberKeyDown = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      replaceCardSelection(event.currentTarget, event.key);
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      deleteCardSelection(event.currentTarget, event.key === "Backspace" ? "backward" : "forward");
    }
  };

  const handleCardNumberBeforeInput = (event) => {
    const inputType = event.nativeEvent?.inputType;
    const inputData = event.nativeEvent?.data;

    if (inputType === "insertText" && /^\d+$/.test(inputData || "")) {
      event.preventDefault();
      replaceCardSelection(event.currentTarget, inputData);
      return;
    }

    if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") {
      event.preventDefault();
      deleteCardSelection(event.currentTarget, inputType === "deleteContentBackward" ? "backward" : "forward");
    }
  };

  const handleCardNumberPaste = (event) => {
    const pastedDigits = sanitizeCardNumberInput(event.clipboardData.getData("text"));
    if (!pastedDigits) return;

    event.preventDefault();
    const displayValue = event.currentTarget.value;
    const rawSelectionStart = displayIndexToRawIndex(displayValue, event.currentTarget.selectionStart ?? 0);
    const rawSelectionEnd = displayIndexToRawIndex(displayValue, event.currentTarget.selectionEnd ?? rawSelectionStart);
    const availableDigits = 16 - (cardNumber.length - (rawSelectionEnd - rawSelectionStart));
    const insertedDigits = pastedDigits.slice(0, Math.max(0, availableDigits));
    const nextRaw = `${cardNumber.slice(0, rawSelectionStart)}${insertedDigits}${cardNumber.slice(rawSelectionEnd)}`;
    updateCardNumber(nextRaw, rawSelectionStart + insertedDigits.length);
  };

  useEffect(() => {
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
    if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current);

    if (!paymentOpen) {
      setRenderedStep(paymentStep);
      setStepMotion("");
      return undefined;
    }

    if (paymentStep === renderedStep) return undefined;

    if (prefersReducedMotion()) {
      setRenderedStep(paymentStep);
      setStepMotion("");
      return undefined;
    }

    const direction = STEP_ORDER[paymentStep] > STEP_ORDER[renderedStep] ? "forward" : "backward";
    const phaseDuration = STEP_TRANSITION_MS / 2;
    setStepMotion(`exit-${direction}`);

    swapTimerRef.current = window.setTimeout(() => {
      setRenderedStep(paymentStep);
      setStepMotion(`enter-${direction}`);
      enterTimerRef.current = window.setTimeout(() => setStepMotion(""), phaseDuration);
    }, phaseDuration);

    return () => {
      if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
      if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current);
    };
  }, [paymentOpen, paymentStep]);

  useEffect(() => () => {
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
    if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current);
  }, []);

  if (!paymentOpen) return null;

  // Portal to <body> so the fixed overlay escapes the .dashboard-main stacking
  // context (z-index:1) and the fixed sidebar (z-index:180): the backdrop then
  // covers the WHOLE shell (sidebar + topbar + main) and centres on the viewport.
  return createPortal(
    <div
      className={`balance-payment-modal owner-modal-backdrop ${motionClassName}`}
      style={motionStyle}
      role="presentation"
      onMouseDown={requestClose}
      onAnimationEnd={handleAnimationEnd}
    >
      <section ref={dialogRef} className="balance-payment-dialog balance-payment-dialog--card" role="dialog" aria-modal="true" aria-labelledby="balance-payment-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="balance-card-step">
          <aside className="balance-card-step__side balance-card-step__brand-panel">
            <div className="balance-card-step__brand-content">
              <img className="balance-card-step__brand-mark" src={marjonBalanceMark} alt="" aria-hidden="true" data-testid="balance-brand-logo" />
              <strong className="balance-card-step__brand-name">MARJON</strong>
              <span className="balance-card-step__brand-caption">RESTAURANT OS</span>
              <i className="balance-card-step__brand-divider" aria-hidden="true" />
              <h2>Удобное пополнение баланса</h2>
              <p>Быстрая и безопасная оплата для бесперебойной работы вашего ресторана.</p>
            </div>
          </aside>
          <div className="balance-card-step__form balance-payment-shell" data-testid="balance-payment-shell">
            <div className="balance-payment-dialog__head balance-payment-dialog__head--embedded" data-testid="balance-payment-header">
              <div>
                <span>Оплата баланса</span>
                <h2 id="balance-payment-title">Оплата</h2>
              </div>
              <button className="balance-card-back balance-card-back--icon" type="button" aria-label="Закрыть" onClick={requestClose}>
                <Icon name="bi-x-lg" size={18} />
              </button>
            </div>

            <div className="balance-payment-shell__progress-row" data-testid="balance-payment-stepper-shell">
              <div className="balance-payment-dialog__stepper">
                <PaymentStepper
                  activeStep={STEP_ORDER[renderedStep]}
                  onBackToMethods={backToPaymentMethods}
                  onBackToCardDetails={backToCardDetails}
                />
              </div>
            </div>

            <div className="balance-payment-shell__dynamic-frame">
              {renderedStep === "method" ? (
                <div className={`balance-payment-dynamic balance-payment-method-step ${stepMotionClassName}`} data-payment-step="method">
                  <div className="balance-payment-dialog__field">
                    <span>Payment ID</span>
                    <strong>Недоступно</strong>
                  </div>
                  <div className="balance-payment-methods" role="radiogroup" aria-label="Способ оплаты">
                    <button
                      className={`balance-payment-method ${paymentMethod === "uzcard" ? "is-selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod === "uzcard"}
                      onClick={() => setPaymentMethod("uzcard")}
                    >
                      <span className="balance-payment-method__check" aria-hidden="true" />
                      <span className="balance-payment-method__logos">
                        <img src={uzcardLogo} alt="UzCard" />
                      </span>
                      <span>UzCard / Humo</span>
                    </button>
                    <button
                      className={`balance-payment-method ${paymentMethod === "visa" ? "is-selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod === "visa"}
                      onClick={() => setPaymentMethod("visa")}
                    >
                      <span className="balance-payment-method__check" aria-hidden="true" />
                      <span className="balance-payment-method__logos balance-payment-method__logos--visa">
                        <img src={visaLogo} alt="Visa" />
                      </span>
                      <span>Visa / Mastercard</span>
                    </button>
                  </div>
                </div>
              ) : renderedStep === "card" ? (
                <div className={`balance-payment-dynamic balance-payment-card-fields ${stepMotionClassName}`} data-payment-step="card">
                  <span className="balance-card-step__selected-method">Выбранный способ оплаты: {paymentMethodLabel}</span>
                  <label className="balance-card-field">
                    <span>Сумма</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Введите сумму"
                      value={formatAmountDisplay(cardAmount)}
                      aria-invalid={amountHasError || undefined}
                      className={[cardAmount ? "is-filled" : "", amountHasError ? "is-invalid" : ""].filter(Boolean).join(" ")}
                      onChange={(e) => setCardAmount(sanitizeAmountInput(e.target.value))}
                    />
                  </label>
                  <div className="balance-card-quick">
                    <button type="button" tabIndex={-1} onClick={() => setCardAmount("390000")}>390 000</button>
                    <button type="button" tabIndex={-1} onClick={() => setCardAmount("490000")}>490 000</button>
                    <button type="button" tabIndex={-1} onClick={() => setCardAmount("1000000")}>1 000 000</button>
                  </div>
                  <div className="balance-card-grid">
                    <label className="balance-card-field">
                      <span>Номер карты</span>
                      <input
                        type="text"
                        ref={cardInputRef}
                        inputMode="numeric"
                        placeholder="0000 0000 0000 0000"
                        autoComplete="off"
                        maxLength={19}
                        value={formatCardNumberDisplay(cardNumber)}
                        aria-invalid={cardHasError || undefined}
                        className={[cardNumber ? "is-filled" : "", cardHasError ? "is-invalid" : ""].filter(Boolean).join(" ")}
                        onChange={handleCardNumberChange}
                        onKeyDown={handleCardNumberKeyDown}
                        onBeforeInput={handleCardNumberBeforeInput}
                        onPaste={handleCardNumberPaste}
                        onSelect={rememberCardSelection}
                      />
                    </label>
                    <label className="balance-card-field">
                      <span>Срок действия</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="ММ/ГГ"
                        autoComplete="off"
                        maxLength={5}
                        value={formatExpiryDisplay(cardExpiry)}
                        aria-invalid={expiryHasError || undefined}
                        title={expiryHasError ? (expiryInvalid ? "Месяц должен быть от 01 до 12" : "Введите срок действия в формате ММ/ГГ") : undefined}
                        className={[cardExpiry ? "is-filled" : "", expiryHasError ? "is-invalid" : ""].filter(Boolean).join(" ")}
                        onChange={(e) => setCardExpiry(sanitizeExpiryInput(e.target.value))}
                      />
                    </label>
                  </div>
                  <label className="balance-offer balance-offer--check">
                    <input type="checkbox" checked={offerAccepted} onChange={(e) => setOfferAccepted(e.target.checked)} />
                    <span>Я ознакомлен с <a href="#" tabIndex={-1} onClick={(e) => e.preventDefault()}>публичной офертой</a></span>
                  </label>
                </div>
              ) : renderedStep === "confirm" ? (
                <div className={`balance-payment-dynamic balance-payment-confirmation ${stepMotionClassName}`} data-payment-step="confirm">
                  <div className="balance-payment-confirmation__card" role="group" aria-label="Сводка платежа">
                    <div className="balance-payment-confirmation__row">
                      <span>Способ оплаты</span>
                      <strong className="balance-payment-confirmation__method">
                        <img src={paymentMethodLogo} alt="" aria-hidden="true" />
                        {paymentMethodLabel}
                      </strong>
                    </div>
                    <div className="balance-payment-confirmation__row">
                      <span>Сумма</span>
                      <strong>{formatAmountDisplay(cardAmount)} UZS</strong>
                    </div>
                    <div className="balance-payment-confirmation__row">
                      <span>Карта</span>
                      <strong data-testid="balance-masked-card">{maskedCardNumber}</strong>
                    </div>
                    <div className="balance-payment-confirmation__row">
                      <span>Срок действия</span>
                      <strong>{formatExpiryDisplay(cardExpiry)}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className={`balance-payment-dynamic balance-payment-success ${stepMotionClassName}`}
                  data-payment-step="success"
                  role="status"
                >
                  <span className="balance-payment-success__icon" aria-hidden="true">
                    <Icon name="bi-check2" size={28} strokeWidth={2.6} />
                  </span>
                  <h3>Платёж принят в обработку</h3>
                  <p>Мы уведомим вас после завершения операции.</p>
                </div>
              )}
            </div>

            <button
              className={`balance-payment-submit balance-payment-submit--wide balance-payment-shell__cta ${(renderedStep === "card" && !cardValid) || renderedStep === "confirm" || (renderedStep === "method" && !paymentMethod) ? "is-disabled" : ""}`}
              type="button"
              disabled={(renderedStep === "card" && !cardValid) || renderedStep === "confirm" || (renderedStep === "method" && !paymentMethod)}
              aria-disabled={(renderedStep === "card" && !cardValid) || renderedStep === "confirm" || (renderedStep === "method" && !paymentMethod) ? "true" : undefined}
              onClick={renderedStep === "success" ? requestClose : renderedStep === "method" ? openPaymentWindow : renderedStep === "card" && cardValid ? openConfirmation : undefined}
              data-testid="balance-payment-cta"
            >
              <span>{renderedStep === "success" ? "Закрыть" : renderedStep === "card" ? "Перейти к подтверждению" : "Оплатить"}</span>
            </button>
            <div className="balance-payment-shell__footer-space" aria-hidden="true" />
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

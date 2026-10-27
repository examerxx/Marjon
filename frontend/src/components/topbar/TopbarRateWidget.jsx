import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { exchangeRatesService } from "../../api/exchangeRates";
import kgFlag from "../../assets/flags/kg.svg";
import kzFlag from "../../assets/flags/kz.svg";
import ruFlag from "../../assets/flags/ru.svg";
import usFlag from "../../assets/flags/us.svg";
import uzFlag from "../../assets/flags/uz.svg";
import Icon from "../Icon";
import { formatMoneyInput, parseMoneyInput } from "./currencyFormat";
import { t } from "../../i18n/t";

const RATE_POPOVER_EXIT_MS = 180;
const SWAP_VALUE_ANIMATION_MS = 180;
const SWAP_VALUE_HALF_MS = SWAP_VALUE_ANIMATION_MS / 2;
const CURRENCY_FLAG_BY_CODE = {
  USD: usFlag,
  RUB: ruFlag,
  KZT: kzFlag,
  KGS: kgFlag,
  UZS: uzFlag,
};
const CURRENCY_COUNTRY_BY_CODE = {
  USD: "US",
  RUB: "RU",
  KZT: "KZ",
  KGS: "KG",
  UZS: "UZ",
};

// Виджет курсов валют ЦБ Узбекистана + конвертер (Topbar OWNER).
// Вынесено из Topbar.jsx (FE-07B): владеет собственным состоянием и загрузкой
// курсов через exchangeRatesService (FE-05). AbortController сохранён (FE-06).
export default function TopbarRateWidget() {
  const rateWidgetRef = useRef(null);
  const rateTriggerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const restoreFocusRef = useRef(false);
  const swapTimerRef = useRef(null);
  const swapEndTimerRef = useRef(null);
  const swapAnimatingRef = useRef(false);
  const [usdRate, setUsdRate] = useState(null);
  const [rubRate, setRubRate] = useState(null);
  const [kztRate, setKztRate] = useState(null);
  const [kgsRate, setKgsRate] = useState(null);
  const [activeCurrency, setActiveCurrency] = useState("USD");
  const activeRate = activeCurrency === "USD" ? usdRate
    : activeCurrency === "RUB" ? rubRate
    : activeCurrency === "KZT" ? kztRate
    : kgsRate;
  const [rateOpen, setRateOpen] = useState(false);
  const [rateClosing, setRateClosing] = useState(false);
  const [usdAmount, setUsdAmount] = useState("1");
  const [converterDirection, setConverterDirection] = useState("usd-to-uzs");
  const [swapPhase, setSwapPhase] = useState("idle");
  const [widgetError, setWidgetError] = useState(false);

  const convertedAmount = useMemo(() => {
    const amount = parseMoneyInput(usdAmount);
    if (!activeRate) return "";
    if (converterDirection === "uzs-to-usd") {
      return formatMoneyInput((amount / activeRate).toFixed(2).replace(".", ","), true);
    }
    return formatMoneyInput(String(Math.round(amount * activeRate)));
  }, [converterDirection, usdAmount, activeRate]);
  const converterSource = converterDirection === "usd-to-uzs"
    ? { label: activeCurrency, inputMode: "decimal" }
    : { label: "UZS", inputMode: "numeric" };
  const converterTarget = converterDirection === "usd-to-uzs"
    ? { label: "UZS", inputMode: "numeric" }
    : { label: activeCurrency, inputMode: "decimal" };
  const converterDirectionLabel = converterDirection === "usd-to-uzs"
    ? `${activeCurrency} → UZS` : `UZS → ${activeCurrency}`;

  function toggleConverterDirection() {
    if (swapAnimatingRef.current) return;

    const nextAmount = convertedAmount || "1";
    const applySwap = () => {
      setUsdAmount(nextAmount);
      setConverterDirection((current) => (current === "usd-to-uzs" ? "uzs-to-usd" : "usd-to-uzs"));
    };

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      applySwap();
      return;
    }

    swapAnimatingRef.current = true;
    setSwapPhase("out");
    swapTimerRef.current = window.setTimeout(() => {
      applySwap();
      setSwapPhase("in");
      swapTimerRef.current = null;
      swapEndTimerRef.current = window.setTimeout(() => {
        setSwapPhase("idle");
        swapAnimatingRef.current = false;
        swapEndTimerRef.current = null;
      }, SWAP_VALUE_HALF_MS);
    }, SWAP_VALUE_HALF_MS);
  }

  const finishRateClose = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setRateOpen(false);
    setRateClosing(false);
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      rateTriggerRef.current?.focus();
    }
  }, []);

  const openRate = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    restoreFocusRef.current = false;
    setRateClosing(false);
    setRateOpen(true);
  }, []);

  const closeRate = useCallback((restoreFocus = false) => {
    if (!rateOpen || rateClosing) return;
    restoreFocusRef.current = restoreFocus;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finishRateClose();
      return;
    }
    setRateClosing(true);
    closeTimerRef.current = window.setTimeout(finishRateClose, RATE_POPOVER_EXIT_MS + 40);
  }, [finishRateClose, rateClosing, rateOpen]);

  useEffect(() => {
    const controller = new AbortController();

    function fetchRate(currency, setter) {
      return exchangeRatesService.get(currency, { signal: controller.signal })
        .then((data) => {
          const rate = Number(data?.[0]?.Rate);
          const nominal = Number(data?.[0]?.Nominal) || 1;
          if (Number.isFinite(rate) && rate > 0) setter(rate / nominal);
        })
        .catch(() => { if (!controller.signal.aborted) setWidgetError(true); });
    }

    function loadInfoWidgets() {
      setWidgetError(false);
      Promise.all([
        fetchRate("USD", setUsdRate),
        fetchRate("RUB", setRubRate),
        fetchRate("KZT", setKztRate),
        fetchRate("KGS", setKgsRate),
      ]);
    }

    loadInfoWidgets();
    const id = window.setInterval(loadInfoWidgets, 10 * 60 * 1000);
    return () => { controller.abort(); window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!rateOpen || rateClosing) return undefined;

    function handleClickOutside(event) {
      if (!rateWidgetRef.current?.contains(event.target)) {
        closeRate(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRate(true);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeRate, rateClosing, rateOpen]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
    if (swapEndTimerRef.current) window.clearTimeout(swapEndTimerRef.current);
  }, []);

  return (
    <div className="topbar-info-widgets" aria-label={t("components.topbar.topbarratewidget.informatsionnye_vidzhety")} ref={rateWidgetRef}>
      <button
        ref={rateTriggerRef}
        className={`topbar-info-widget topbar-info-widget--rate ${rateOpen && !rateClosing ? "is-open" : ""}`}
        type="button"
        onClick={() => (rateOpen ? closeRate(true) : openRate())}
        aria-expanded={rateOpen && !rateClosing}
        aria-haspopup="dialog"
      >
        <span className="topbar-info-widget__icon">
          <Icon name="bi-currency-exchange" size={17} />
        </span>
        <strong className="topbar-info-widget__body">
          {activeRate ? (
            <><span className="topbar-info-widget__num">{activeRate.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} </span>UZS/{activeCurrency}</>
          ) : "—"}
        </strong>
        {widgetError && !usdRate
          ? <Icon name="bi-wifi-off" size={15} className="topbar-info-widget__trend" />
          : null}
      </button>
      {rateOpen ? (
        <div
          className={`usd-rate-popover ${rateClosing ? "is-closing" : "is-opening"}`}
          role="dialog"
          aria-label={t("components.topbar.topbarratewidget.kursy_valyut")}
          aria-hidden={rateClosing || undefined}
          onAnimationEnd={(event) => {
            if (rateClosing && event.target === event.currentTarget) finishRateClose();
          }}
        >
          <div className="usd-rate-popover__head">
            <div>
              <span>{t("components.topbar.topbarratewidget.ofitsialnyy_kurs_tsb_uzbekistana")}</span>
              <strong>{t("components.topbar.topbarratewidget.kursy_valyut")}</strong>
            </div>
            <button type="button" aria-label={t("components.topbar.topbarratewidget.zakryt")} onClick={() => closeRate(true)}>
              <Icon name="bi-x-lg" size={18} />
            </button>
          </div>

          <div className="currency-rate-cards">
            {[
              { code: "USD", flag: CURRENCY_FLAG_BY_CODE.USD, label: t("components.topbar.topbarratewidget.dollar_ssha"),         rate: usdRate, decimals: 0 },
              { code: "RUB", flag: CURRENCY_FLAG_BY_CODE.RUB, label: t("components.topbar.topbarratewidget.rossiyskiy_rubl"),    rate: rubRate, decimals: 1 },
              { code: "KZT", flag: CURRENCY_FLAG_BY_CODE.KZT, label: t("components.topbar.topbarratewidget.kazahstanskiy_tenge"), rate: kztRate, decimals: 1 },
              { code: "KGS", flag: CURRENCY_FLAG_BY_CODE.KGS, label: t("components.topbar.topbarratewidget.kirgizskiy_som"),      rate: kgsRate, decimals: 0 },
            ].map(({ code, flag, label, rate, decimals }) => (
              <button
                key={code}
                type="button"
                className={`currency-rate-card ${activeCurrency === code ? "is-active" : ""}`}
                onClick={() => { setActiveCurrency(code); setUsdAmount("1"); setConverterDirection("usd-to-uzs"); }}
              >
                <span className="currency-rate-card__code">
                  <img
                    className="currency-rate-card__flag"
                    src={flag}
                    alt=""
                    aria-hidden="true"
                    data-country={CURRENCY_COUNTRY_BY_CODE[code]}
                  />
                  {code}
                </span>
                <strong className="currency-rate-card__rate">
                  {rate
                    ? rate.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
                    : "—"}
                </strong>
                <span className="currency-rate-card__unit">UZS</span>
              </button>
            ))}
          </div>

          <div className="usd-rate-popover__meta">
            <button
              className="usd-rate-direction-toggle"
              type="button"
              onClick={toggleConverterDirection}
              aria-label={t("components.topbar.topbarratewidget.pomenyat_napravlenie")}
              aria-disabled={swapPhase !== "idle"}
            >
              <span>{converterDirectionLabel}</span>
              <Icon name="bi-arrow-left-right" size={16} />
            </button>
            <span>{t("components.topbar.topbarratewidget.istochnik_cbu_uz")}</span>
          </div>
          <div className="usd-converter">
            <label>
              <input
                className={`usd-converter__value usd-converter__value--source ${swapPhase === "idle" ? "" : `is-swapping-${swapPhase}`}`}
                value={usdAmount}
                inputMode={converterSource.inputMode}
                onChange={(event) => setUsdAmount(formatMoneyInput(event.target.value, converterDirection === "usd-to-uzs"))}
              />
              <span className="usd-converter__currency">
                {converterSource.label}
                <img
                  className="usd-converter__flag"
                  src={CURRENCY_FLAG_BY_CODE[converterSource.label]}
                  alt=""
                  aria-hidden="true"
                  data-country={CURRENCY_COUNTRY_BY_CODE[converterSource.label]}
                />
              </span>
            </label>
            <label>
              <input
                className={`usd-converter__value usd-converter__value--target ${swapPhase === "idle" ? "" : `is-swapping-${swapPhase}`}`}
                value={convertedAmount}
                inputMode={converterTarget.inputMode}
                onChange={(event) => {
                  const value = parseMoneyInput(event.target.value);
                  if (!activeRate) { setUsdAmount("0"); return; }
                  if (converterDirection === "uzs-to-usd") {
                    setUsdAmount(formatMoneyInput(String(Math.round(value * activeRate))));
                    return;
                  }
                  setUsdAmount(formatMoneyInput(String((value / activeRate).toFixed(2)).replace(".", ","), true));
                }}
              />
              <span className="usd-converter__currency">
                {converterTarget.label}
                <img
                  className="usd-converter__flag"
                  src={CURRENCY_FLAG_BY_CODE[converterTarget.label]}
                  alt=""
                  aria-hidden="true"
                  data-country={CURRENCY_COUNTRY_BY_CODE[converterTarget.label]}
                />
              </span>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

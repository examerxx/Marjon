import { useEffect, useMemo, useRef, useState } from "react";
import { exchangeRatesService } from "../../api/exchangeRates";
import Icon from "../Icon";
import { formatMoneyInput, parseMoneyInput } from "./currencyFormat";

// Виджет курсов валют ЦБ Узбекистана + конвертер (Topbar OWNER).
// Вынесено из Topbar.jsx (FE-07B): владеет собственным состоянием и загрузкой
// курсов через exchangeRatesService (FE-05). AbortController сохранён (FE-06).
export default function TopbarRateWidget() {
  const rateWidgetRef = useRef(null);
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
  const [usdAmount, setUsdAmount] = useState("1");
  const [converterDirection, setConverterDirection] = useState("usd-to-uzs");
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
    setUsdAmount(convertedAmount || "1");
    setConverterDirection((current) => (current === "usd-to-uzs" ? "uzs-to-usd" : "usd-to-uzs"));
  }

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
    function handleClickOutside(event) {
      if (!rateWidgetRef.current?.contains(event.target)) {
        setRateOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="topbar-info-widgets" aria-label="Информационные виджеты" ref={rateWidgetRef}>
      <button className={`topbar-info-widget topbar-info-widget--rate ${rateOpen ? "is-open" : ""}`} type="button" onClick={() => setRateOpen((value) => !value)} aria-expanded={rateOpen} aria-haspopup="dialog">
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
        <div className="usd-rate-popover" role="dialog" aria-label="Курсы валют">
          <div className="usd-rate-popover__head">
            <div>
              <span>Официальный курс ЦБ Узбекистана</span>
              <strong>Курсы валют</strong>
            </div>
            <button type="button" aria-label="Закрыть" onClick={() => setRateOpen(false)}>
              <Icon name="bi-x-lg" size={18} />
            </button>
          </div>

          <div className="currency-rate-cards">
            {[
              { code: "USD", flag: "🇺🇸", label: "Доллар США",         rate: usdRate, decimals: 0 },
              { code: "RUB", flag: "🇷🇺", label: "Российский рубль",    rate: rubRate, decimals: 1 },
              { code: "KZT", flag: "🇰🇿", label: "Казахстанский тенге", rate: kztRate, decimals: 1 },
              { code: "KGS", flag: "🇰🇬", label: "Киргизский сом",      rate: kgsRate, decimals: 0 },
            ].map(({ code, flag, label, rate, decimals }) => (
              <button
                key={code}
                type="button"
                className={`currency-rate-card ${activeCurrency === code ? "is-active" : ""}`}
                onClick={() => { setActiveCurrency(code); setUsdAmount("1"); setConverterDirection("usd-to-uzs"); }}
              >
                <span className="currency-rate-card__code">{code}</span>
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
            <button className="usd-rate-direction-toggle" type="button" onClick={toggleConverterDirection} aria-label="Поменять направление">
              <span>{converterDirectionLabel}</span>
              <Icon name="bi-arrow-left-right" size={16} />
            </button>
            <span>Источник: cbu.uz</span>
          </div>
          <div className="usd-converter">
            <label>
              <input
                value={usdAmount}
                inputMode={converterSource.inputMode}
                onChange={(event) => setUsdAmount(formatMoneyInput(event.target.value, converterDirection === "usd-to-uzs"))}
              />
              <span>{converterSource.label}</span>
            </label>
            <label>
              <input value={convertedAmount} inputMode={converterTarget.inputMode} onChange={(event) => {
                const value = parseMoneyInput(event.target.value);
                if (!activeRate) { setUsdAmount("0"); return; }
                if (converterDirection === "uzs-to-usd") {
                  setUsdAmount(formatMoneyInput(String(Math.round(value * activeRate))));
                  return;
                }
                setUsdAmount(formatMoneyInput(String((value / activeRate).toFixed(2)).replace(".", ","), true));
              }} />
              <span>{converterTarget.label}</span>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

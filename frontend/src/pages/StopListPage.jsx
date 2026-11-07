import { useEffect, useMemo, useState } from "react";
import { catalogService } from "../api/catalog";
import { formatMoney } from "../api/client";
import Icon from "../components/Icon";
import { isAbortError, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";

// Стоп-лист: блюда, временно снятые с продажи. Правит доступность
// (is_available) и дневной лимит порций через узкие inventory-эндпоинты.
// Данные только с бэкенда: пусто/ошибка — честные состояния (5.1 CLAUDE.md).
function isStopped(p) {
  return p.is_available === false || p.stop_list === true;
}

export default function StopListPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [onlyStop, setOnlyStop] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [limitDraft, setLimitDraft] = useState({});
  const [limitBusyId, setLimitBusyId] = useState(null);
  const beginRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  async function load() {
    const request = beginRequest();
    setLoading(true);
    setError("");
    try {
      const { data } = await catalogService.listProducts({
        params: { include_all: true },
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      setProducts(Array.isArray(data) ? data : data?.items || []);
    } catch (err) {
      if (!request.isCurrent() || isAbortError(err)) return;
      setProducts([]);
      setError(err.response?.data?.detail || "Не удалось загрузить блюда.");
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(p) {
    const makeAvailable = isStopped(p);
    if (!acquire(`avail-${p.id}`)) return;
    setBusyId(p.id);
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_available: makeAvailable } : x)));
    try {
      const { data } = await catalogService.setProductAvailability(p.id, makeAvailable);
      if (data?.id) setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...data } : x)));
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось изменить доступность.");
      load();
    } finally {
      setBusyId(null);
      release(`avail-${p.id}`);
    }
  }

  function draftFor(p) {
    return limitDraft[p.id] !== undefined ? limitDraft[p.id] : (p.daily_limit ?? "");
  }

  async function saveLimit(p) {
    const raw = String(draftFor(p)).trim();
    let value = null;
    if (raw !== "") {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 1) {
        setError("Лимит должен быть целым числом ≥ 1.");
        return;
      }
      value = n;
    }
    if (!acquire(`limit-${p.id}`)) return;
    setLimitBusyId(p.id);
    setError("");
    try {
      const { data } = await catalogService.setProductDailyLimit(p.id, value);
      if (data?.id) setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...data } : x)));
      setLimitDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next; });
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить лимит.");
    } finally {
      setLimitBusyId(null);
      release(`limit-${p.id}`);
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (onlyStop && !isStopped(p)) return false;
      if (q && !String(p.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, onlyStop, search]);

  const stopCount = useMemo(() => products.filter(isStopped).length, [products]);

  return (
    <section className="nomenclature-page stoplist-page">
      <div className="stoplist-card">
        <div className="stoplist-header">
          <div className="stoplist-title">
            <span className="stoplist-accent" />
            <div>
              <h1>Стоп-лист</h1>
              <p>Временно недоступные блюда{stopCount ? ` · в стопе: ${stopCount}` : ""}</p>
            </div>
          </div>
          <div className="stoplist-controls">
            <div className="stoplist-search">
              <Icon name="bi-search" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск блюда"
              />
            </div>
            <button
              type="button"
              className={`stoplist-filter ${onlyStop ? "is-active" : ""}`}
              onClick={() => setOnlyStop((value) => !value)}
            >
              Только в стопе
            </button>
          </div>
        </div>

        {error ? <div className="login-error" role="alert">{error}</div> : null}

        <div className="stoplist-grid" aria-busy={loading}>
          {loading
            ? Array.from({ length: 8 }, (_, index) => <div className="stoplist-item is-loading" key={index} />)
            : visible.map((p) => {
                const stopped = isStopped(p);
                return (
                  <article className={`stoplist-item ${stopped ? "is-stop" : ""}`} key={p.id}>
                    <div className="stoplist-item__head">
                      <span className="stoplist-item__thumb">
                        {p.image_url
                          ? <img src={p.image_url} alt="" loading="lazy" />
                          : <Icon name="bi-basket" size={22} />}
                      </span>
                      <div className="stoplist-item__info">
                        <strong>{p.name}</strong>
                        <span>{formatMoney(p.price)}</span>
                      </div>
                      <span className={`stoplist-item__status ${stopped ? "is-stop" : "is-ok"}`}>
                        {stopped ? "В стопе" : "В продаже"}
                      </span>
                    </div>
                    <div className="stoplist-item__actions">
                      <button
                        type="button"
                        className={`stoplist-toggle ${stopped ? "is-return" : "is-stop"}`}
                        disabled={busyId === p.id}
                        onClick={() => toggle(p)}
                      >
                        <Icon name={stopped ? "bi-check2" : "bi-x-octagon"} size={16} />
                        <span>{stopped ? "Вернуть в продажу" : "В стоп"}</span>
                      </button>
                      <div className="stoplist-limit">
                        <input
                          type="number"
                          min="1"
                          inputMode="numeric"
                          placeholder="Лимит/день"
                          value={draftFor(p)}
                          disabled={limitBusyId === p.id}
                          onChange={(event) => setLimitDraft((prev) => ({ ...prev, [p.id]: event.target.value }))}
                          onKeyDown={(event) => { if (event.key === "Enter") saveLimit(p); }}
                        />
                        <button type="button" disabled={limitBusyId === p.id} onClick={() => saveLimit(p)}>
                          ОК
                        </button>
                      </div>
                    </div>
                    {p.daily_limit != null ? (
                      <p className="stoplist-item__sold">
                        Продано: <strong>{p.sold_count ?? 0}</strong> / {p.daily_limit}
                      </p>
                    ) : null}
                  </article>
                );
              })}

          {!loading && !error && !visible.length ? (
            <div className="stoplist-empty">
              <Icon name="bi-inbox" />
              <span>{products.length ? "Ничего не найдено." : "Блюд пока нет."}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import brandMark from "../assets/brand/marjon-neon-logo-v110.png";
import { fetchDisplayBoard, getTvBranchId } from "./api";
import { t as tr } from "../i18n/t";

const POLL_MS = 4000;
const PAGE_MS = 8000;
// На ТВ только время: ни секунд, ни даты — гость смотрит на номера заказов.
const CLOCK = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit", minute: "2-digit", hour12: false,
});

function OrderNumber({ order }) {
  return (
    <article
      className={`tv-card tv-card--${order.status}`}
      aria-label={`${tr("kitchen.tv.order")} ${order.number}`}
    >
      <span className="tv-card__num" style={{ "--digits": Math.max(4, String(order.number).length) }}>{order.number}</span>
      <span className="tv-card__state">
        {order.status === "ready" ? tr("kitchen.tv.ready") : tr("kitchen.tv.queued")}
      </span>
    </article>
  );
}

function OrderSection({ orders, kind, empty }) {
  const gridRef = useRef(null);
  const [capacity, setCapacity] = useState(1);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(orders.length / capacity));
  const currentPage = page % pages;

  useEffect(() => {
    const grid = gridRef.current;
    const measure = () => {
      const css = getComputedStyle(grid);
      const columns = css.gridTemplateColumns.split(" ").length;
      const rowHeight = parseFloat(css.gridAutoRows);
      const gap = parseFloat(css.rowGap) || 0;
      const rows = Math.max(1, Math.floor((grid.clientHeight + gap) / (rowHeight + gap)));
      setCapacity(Math.max(1, columns * rows));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pages <= 1) return;
    const timer = setInterval(() => setPage((value) => (value + 1) % pages), PAGE_MS);
    return () => clearInterval(timer);
  }, [pages]);

  // Заголовков «готовится»/«готово» нет: колонки различаются цветом, а статус
  // написан на самой карточке. Единственный служебный текст — номер страницы,
  // когда заказов больше, чем влезает на экран.
  return (
    <section className={`tv-section tv-section--${kind}`}>
      {pages > 1 ? <span className="tv-section__page">{currentPage + 1} / {pages}</span> : null}
      <div ref={gridRef} className={`tv-grid tv-grid--${kind}`}>
        {orders.length
          ? orders.slice(currentPage * capacity, (currentPage + 1) * capacity).map((order) => (
              <OrderNumber key={order.number} order={order} />
            ))
          : <p className="tv-section__empty">{empty}</p>}
      </div>
    </section>
  );
}

export default function TvApp() {
  const [branchId] = useState(getTvBranchId);
  const [board, setBoard] = useState(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!branchId) return;
    let stopped = false;
    let timer;
    let controller;
    let revision = 0;

    const tick = async () => {
      const current = ++revision;
      clearTimeout(timer);
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const data = await fetchDisplayBoard(branchId, request.signal);
        if (stopped || current !== revision) return;
        setBoard(data);
        setOffline(false);
      } catch {
        if (!stopped && current === revision) setOffline(true);
      } finally {
        clearTimeout(timeout);
        if (!stopped && current === revision) timer = setTimeout(tick, POLL_MS);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [branchId]);

  const { ready, queued } = useMemo(() => {
    const orders = board?.orders ?? [];
    return {
      ready: orders.filter((order) => order.status === "ready"),
      queued: orders.filter((order) => order.status === "queued"),
    };
  }, [board]);

  // Касса выключила экран в настройках десктопа: не показываем номера, даже
  // если в зале что-то готовится. Опрос продолжается — включение вернёт доску.
  if (board?.enabled === false) {
    return (
      <div className="tv tv--off">
        <div className="tv-off">
          <img src={brandMark} alt="" aria-hidden="true" />
          <h1>{tr("kitchen.tv.disabled_title")}</h1>
          <p>{tr("kitchen.tv.disabled_hint")}</p>
        </div>
      </div>
    );
  }

  if (!branchId) {
    return (
      <div className="tv tv--setup">
        <div className="tv-setup">
          <img src={brandMark} alt="Marjon" width={72} height={72} />
          <h1>{tr("kitchen.tv.setup_title")}</h1>
          <p>{tr("kitchen.tv.setup_hint")}</p>
          <code>?branch=&lt;ID&gt;</code>
        </div>
      </div>
    );
  }

  const stamp = new Date(now);
  return (
    <div className="tv">
      {/* Шапка: марка и имя аккаунта слева, крупное время справа. Филиал и
          подпись не нужны — экран висит в конкретном зале. */}
      <header className="tv-head">
        <div className="tv-brand">
          <img className="tv-brand__logo" src={brandMark} alt="" width={46} height={34} decoding="async" />
          <span className="tv-brand__text">
            <b>{board?.company_name || tr("kitchen.tv.guest_display")}</b>
          </span>
        </div>
        <div className="tv-head__state">
          {offline ? <span className="tv-offline" role="status">{tr("kitchen.tv.offline")}</span> : null}
          <span className="tv-clock" aria-label={tr("kitchen.kitchenapp.tekuschee_vremya")}>
            {CLOCK.format(stamp)}
          </span>
        </div>
      </header>
      {/* Две половины экрана: слева — что ещё готовится, справа — что уже
          можно забирать. Гость смотрит на правую половину. */}
      <main className="tv-board">
        <OrderSection orders={queued} kind="queue" empty={tr("kitchen.tv.empty_hint")} />
        <OrderSection orders={ready} kind="ready" empty={tr("kitchen.tv.empty")} />
      </main>
      <img className="tv-logo" src={brandMark} alt="" aria-hidden="true" decoding="async" />
    </div>
  );
}

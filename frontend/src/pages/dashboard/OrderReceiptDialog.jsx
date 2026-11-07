import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import { InlineLoader } from "../../components/Loader";
import ReceiptPreview from "../../components/receipt/ReceiptPreview";
import { ordersService } from "../../api/orders";
import { paymentsService } from "../../api/payments";
import { getCustomerTemplate, LINE_SPACING_SMALL } from "../../api/receipt";
import { useOrg } from "../../context/OrgContext";
import { useAnchoredDialogMotion } from "../../hooks/useAnchoredDialogMotion";
import { paymentMethodLabel } from "./analyticsData";
import "./orderReceiptDialog.css";

// Чек заказа из таблицы «Заказов» на дашборде. Показываем его ровно так, как
// используем ReceiptPreview с шаблоном компании. Только в этом просмотрщике
// скрываем логотип, контакты и благодарность; печатный шаблон не меняется.

function toNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

// Ответ /pos/orders/{id} → форма, которую ждёт ReceiptPreview.
function toReceiptOrder(order, payments) {
  return {
    order_number: order.order_number,
    order_type: order.order_type,
    table_number: order.table_number,
    waiter: order.waiter_name || "",
    receipt_staff: order.receipt_staff || [],
    discount: toNumber(order.discount_amount),
    service_fee: toNumber(order.service_fee),
    vat: toNumber(order.tax_amount),
    total_amount: toNumber(order.total_amount),
    created_at: order.created_at,
    payments: payments.map((payment) => ({
      label: paymentMethodLabel(payment.method),
      amount: toNumber(payment.amount),
    })),
    // Отменённые позиции на чек не попадают — как и в печати.
    items: (order.items || [])
      .filter((item) => item.status !== "cancelled")
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantity: toNumber(item.quantity),
        price: toNumber(item.price),
        total: toNumber(item.total),
        note: item.note,
        modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
        takeaway: Boolean(item.takeaway),
      })),
  };
}

export default function OrderReceiptDialog({ orderId, orderNumber, onClose, onOpenDetails }) {
  const { org } = useOrg();
  const [order, setOrder] = useState(null);
  const [payments, setPayments] = useState([]);
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // org в зависимостях эффекта заставил бы перезагружать чек на каждый
  // рефреш профиля компании — берём его из ref.
  const orgRef = useRef(org);
  orgRef.current = org;

  const { dialogRef, motionClassName, motionStyle, requestClose, handleAnimationEnd } =
    useAnchoredDialogMotion({
      isOpen: Boolean(orderId),
      onClose,
      motionMode: "centered",
    });

  useEffect(() => {
    if (!orderId) return undefined;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setOrder(null);
    setPayments([]);

    (async () => {
      try {
        const [orderResult, paymentsResult, templateResult] = await Promise.all([
          ordersService.get(orderId, { signal: controller.signal }),
          // Платежи и шаблон — украшение: без них чек всё равно покажем.
          paymentsService.listByOrder(orderId, { signal: controller.signal })
            .catch(() => ({ data: [] })),
          getCustomerTemplate(orgRef.current, { signal: controller.signal })
            .catch(() => ({ template: null })),
        ]);
        if (!active) return;
        setOrder(orderResult?.data || null);
        setPayments(Array.isArray(paymentsResult?.data) ? paymentsResult.data : []);
        setTemplate(templateResult?.template || null);
      } catch (requestError) {
        if (!active || requestError?.name === "CanceledError" || requestError?.name === "AbortError") return;
        setError("Не удалось загрузить чек заказа.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [orderId]);

  const receiptOrder = useMemo(
    () => (order ? toReceiptOrder(order, payments) : null),
    [order, payments],
  );

  // Keep the large order number at the bottom in this viewer, independently
  // of the printer template's top/bottom placement. Printing is unchanged.
  const previewTemplate = useMemo(() => {
    const source = template || {};
    return {
      ...source,
      // Viewer-only density: never write this override to the print template.
      lineSpacing: LINE_SPACING_SMALL,
      enabled: {
        ...(source.enabled || {}),
        logo: false, address: false, phone: false,
        thankYouText: false, bottomOrderNumber: true,
      },
      blockStyles: { ...source.blockStyles, bottomOrderNumber: { ...source.blockStyles?.bottomOrderNumber, placement: "bottom" } },
    };
  }, [template]);

  if (!orderId) return null;

  const number = orderNumber || order?.order_number || "";

  return createPortal(
    <div
      className={`receipt-dialog-backdrop ${motionClassName}`}
      style={motionStyle}
      role="presentation"
      onMouseDown={requestClose}
      onAnimationEnd={handleAnimationEnd}
    >
      <section
        ref={dialogRef}
        className="receipt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-receipt-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="receipt-dialog__head">
          <div>
            <span>Чек заказа</span>
            <h2 id="order-receipt-title">{number ? `№ ${number}` : "Заказ"}</h2>
          </div>
          <div className="receipt-dialog__actions">
            {/* Необязательный переход к подробностям заказа: есть только там,
                откуда он осмыслен (страница «Отчёт по заказам»). */}
            {onOpenDetails ? (
              <button type="button" className="receipt-dialog__details" onClick={onOpenDetails}>
                Детали заказа
              </button>
            ) : null}
            <button type="button" className="receipt-dialog__close" aria-label="Закрыть чек" onClick={requestClose}>
              <Icon name="bi-x-lg" size={18} />
            </button>
          </div>
        </header>

        {/* Обёртка receipt-settings-page: чековые стили (веса, отступы,
            разделители) живут под этим классом — так превью здесь совпадает
            с превью на странице настроек один в один. */}
        <div className="receipt-dialog__body receipt-settings-page">
          {loading ? (
            <div className="receipt-dialog__state" role="status">
              <InlineLoader text="Загрузка чека…" />
            </div>
          ) : error ? (
            <p className="receipt-dialog__state receipt-dialog__state--error" role="alert">{error}</p>
          ) : receiptOrder ? (
            <ReceiptPreview
              type="customer"
              template={previewTemplate}
              order={receiptOrder}
              org={org}
              fitPane
              /* Shrink the whole receipt inside the screen-bounded panel. */
              fitToHeight="contain"
            />
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

import { t } from "../../i18n/t";
// Единая заглушка категории Финансы (Web Launch V1).
// Один центрированный текст «Скоро, эта категория в разработке»,
// больше ничего: ни таблиц, ни форм.
export default function FinanceStubPage({ title }) {
  return (
    <div className="settings-page">
      <section
        className="settings-card"
        style={{
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          minHeight: 320,
        }}
      >
        <div>
          <h1>{title}</h1>
          <p>{t("pages.finance.financestubpage.skoro_eta_kategoriya_v_razrabotke")}</p>
        </div>
      </section>
    </div>
  );
}

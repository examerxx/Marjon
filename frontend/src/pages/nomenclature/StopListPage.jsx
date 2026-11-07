// Меню → Стоп-лист V3 (OWNER).
// Накопительные пополнения доступного остатка поверх ВСЕХ активных
// продуктов каталога: Остаток = allowance − sold; Предыдущий лимит =
// последние 2 пополнения; Новый лимит = ДОБАВИТЬ (после Save поле пустеет).
// membership/Add/карандаша/селектора единицы нет — только inline ввод,
// read-only единица из Product, явный save/reset.
// Внешняя оболочка и таблица — визуальная семья Блюд (dishes.css):
// белый шелл 18px, шапка с бирюзовым акцентом, thead #EFF6FF,
// строки/hover/скролл как у dish-grid. Отдельный stoplist-скоуп,
// react-overrides.css не тронут.
import { useStopList } from "./useStopList";
import StopListTable from "./StopListTable";
import { t } from "../../i18n/t";

function StopListPage() {
  const stop = useStopList();

  if (stop.apiError && !stop.apiLoading) {
    return (
      <section className="nomenclature-page stoplist-page owner-report-view">
        <div className="login-error" role="alert">{stop.apiError}</div>
      </section>
    );
  }

  return (
    <section className="nomenclature-page stoplist-page owner-report-view">
      <section className="stoplist-card owner-report-surface settings-card">
        <header className="settings-header stoplist-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>{t("pages.nomenclature.stoplistpage.menyu")}</p>
              <h1>{t("pages.nomenclature.stoplistpage.stop_list")}</h1>
            </div>
          </div>
        </header>

        {stop.actionError ? <div className="login-error" role="alert">{stop.actionError}</div> : null}

        <StopListTable
          rows={stop.stopRows}
          newLimits={stop.newLimits}
          setNewLimit={stop.setNewLimit}
          isDirty={stop.isDirty}
          commitTopup={stop.commitTopup}
          applyServerRow={stop.applyServerRow}
          reconcile={stop.reconcile}
          zeroAllowance={stop.zeroAllowance}
          resetHistory={stop.resetHistory}
          savingId={stop.savingId}
        />
      </section>
    </section>
  );
}

export default StopListPage;

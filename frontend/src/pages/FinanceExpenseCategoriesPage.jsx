import FinanceCategoriesPage from "./FinanceCategoriesPage";
import { t } from "../i18n/t";

function FinanceExpenseCategoriesPage() {
  return <FinanceCategoriesPage title={t("pages.financeexpensecategoriespage.kategoriya_rashodov")} kind="expense" />;
}

export default FinanceExpenseCategoriesPage;

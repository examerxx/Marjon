import FinanceCategoriesPage from "./FinanceCategoriesPage";
import { t } from "../i18n/t";

function FinanceIncomeCategoriesPage() {
  return <FinanceCategoriesPage title={t("pages.financeincomecategoriespage.kategoriya_prihodov")} kind="income" />;
}

export default FinanceIncomeCategoriesPage;

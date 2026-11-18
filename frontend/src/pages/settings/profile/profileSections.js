// Конфигурация раздела «Настройки» профиля компании: данные без логики.
// V1: ровно 4 внутренние секции по референсу пользователя.
// Остальные (чек, кассир, онлайн-меню, скидки, конструктор, импорт,
// telegram, старая версия) удалены как дубли/плейсхолдеры.
// V5: иконки — один Lucide-outline ряд (через bi-имена Icon):
// данные — документ с текстом, настройки — слайдеры,
// прочее — список опций, профиль — пользователь с шестернёй.

export const profileSections = [
  { key: "basic", label: "Основные данные", icon: "bi-journal-text" },
  { key: "main", label: "Основные настройки", icon: "bi-sliders" },
  { key: "other", label: "Другие настройки", icon: "bi-list-check" },
  { key: "profile", label: "Настройка профиля", icon: "bi-person-gear" },
  { key: "qr", label: "QR-меню", icon: "bi-qr-code" },
];

export const emptyForm = {
  name: "",
  phone: "",
  address: "",
  inn: "",
  currency: "UZS",
  companyLogo: "",
  profileLogo: "",
};

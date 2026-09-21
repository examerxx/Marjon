// Телефонные утилиты раздела «Сотрудники» OWNER.
// Вынесено из StaffRolePage.jsx (FE-07B). Логика форматирования, инференса
// страны и нормализации сохранена 1:1 (числовой парсинг не ослаблен).
const onlyDigits = (value = "") => String(value).replace(/\D/g, "");

export const phoneCountries = [
  { key: "UZ", label: "Узбекистан", dialCode: "998" },
  { key: "TR", label: "Турция", dialCode: "90" },
  { key: "RU", label: "Россия", dialCode: "7" },
  { key: "KZ", label: "Казахстан", dialCode: "7" },
  { key: "KG", label: "Киргизия", dialCode: "996" },
  { key: "TJ", label: "Таджикистан", dialCode: "992" },
  { key: "TM", label: "Туркменистан", dialCode: "993" },
  { key: "US", label: "Америка", dialCode: "1" },
];

export const phoneCountryMap = phoneCountries.reduce((acc, country) => {
  acc[country.key] = country;
  return acc;
}, {});

export const getPhoneFlag = (countryKey) =>
  `https://purecatamphetamine.github.io/country-flag-icons/3x2/${countryKey}.svg`;

export const inferPhoneCountry = (value = "") => {
  const digits = onlyDigits(value);

  return (
    phoneCountries
      .filter((country) => digits.startsWith(country.dialCode))
      .sort((a, b) => b.dialCode.length - a.dialCode.length)[0]?.key || "UZ"
  );
};

export const getPhoneLocal = (value = "", countryKey = "UZ") => {
  const digits = onlyDigits(value);
  const country = phoneCountryMap[countryKey] || phoneCountryMap.UZ;
  return digits.startsWith(country.dialCode) ? digits.slice(country.dialCode.length) : digits;
};

const formatPhoneLocal = (local = "") => {
  const value = local.slice(0, 10);

  if (value.length <= 3) return value;
  if (value.length <= 6) return `${value.slice(0, 3)} ${value.slice(3)}`;
  if (value.length <= 8) return `${value.slice(0, 3)} ${value.slice(3, 6)}-${value.slice(6)}`;
  return `${value.slice(0, 3)} ${value.slice(3, 6)}-${value.slice(6, 8)}-${value.slice(8, 10)}`;
};

export const formatPhone = (value = "", countryKey = inferPhoneCountry(value)) => {
  const country = phoneCountryMap[countryKey] || phoneCountryMap.UZ;
  const local = getPhoneLocal(value, country.key);

  if (country.key === "UZ") {
    const uzLocal = local.slice(0, 9);
    const parts = [
      uzLocal.slice(0, 2),
      uzLocal.slice(2, 5),
      uzLocal.slice(5, 7),
      uzLocal.slice(7, 9),
    ].filter(Boolean);

    return parts.length
      ? `+${country.dialCode} ${parts[0]}${parts[1] ? ` ${parts[1]}` : ""}${parts[2] ? `-${parts[2]}` : ""}${parts[3] ? `-${parts[3]}` : ""}`
      : "";
  }

  return local ? `+${country.dialCode} ${formatPhoneLocal(local)}` : "";
};

export const normalizePhone = (value = "", countryKey = "UZ") => {
  const country = phoneCountryMap[countryKey] || phoneCountryMap.UZ;
  const parts = [
    country.dialCode,
    getPhoneLocal(value, country.key).slice(0, country.key === "UZ" ? 9 : 10),
  ];

  return parts[1] ? parts.join("") : "";
};

// Display-only UZ local formatter: raw digits → (XX) XXX-XX-XX, progressive.
// Never stored: submit keeps normalizePhone() digits. First 9 digits take the
// pattern, any remainder (non-UZ lengths) appends plainly.
export const formatLocalUZ = (value = "") => {
  const digits = String(value).replace(/\D/g, "");
  const head = digits.slice(0, 9);
  const rest = digits.slice(9);
  if (!head) return "";

  let out = `(${head.slice(0, 2)}`;
  if (head.length < 2) return out;
  out += ")";
  if (head.length === 2) return out + rest;
  out += ` ${head.slice(2, 5)}`;
  if (head.length <= 5) return out + rest;
  out += `-${head.slice(5, 7)}`;
  if (head.length <= 7) return out + rest;
  return `${out}-${head.slice(7, 9)}${rest}`;
};

// Map a digit-count caret through the formatted representation.
export const caretForDigitCount = (digitsBeforeCaret, digits = "") => {
  if (digitsBeforeCaret <= 0) return 0;
  const formatted = formatLocalUZ(digits);
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index])) seen += 1;
    if (seen === digitsBeforeCaret) return index + 1;
  }
  return formatted.length;
};

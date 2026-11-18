import React from "react";
import ReactDOM from "react-dom/client";
import QrMenuApp from "./QrMenuApp.jsx";
import "./styles.css";

// «Версия для ПК» в браузере телефона: страница рисуется шириной ~980px и мобильная
// вёрстка выглядит мелкой (текст в 2–2,5 раза меньше обычного). Распознаём это
// (сенсорный экран, а окно заметно шире самого экрана) и масштабируем rem, чтобы
// страница выглядела как обычная мобильная. На ПК и планшетах ничего не меняется.
function fitDesktopMode() {
  try {
    const device = Math.min(window.screen.width, window.screen.height);
    const ratio = window.innerWidth / device;
    if (window.matchMedia("(pointer: coarse)").matches && device < 700 && ratio > 1.3) {
      document.documentElement.style.fontSize = `${(16 * ratio).toFixed(2)}px`;
    }
  } catch {
    // оставляем адаптивный размер из стилей
  }
}
fitDesktopMode();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QrMenuApp />
  </React.StrictMode>,
);

# Marjon — лендинг «Нить» (3D scrollytelling)

Новый лендинг marjon.tech. Старый лежит рядом в `../landing/` и не тронут.

Стек: Vite 5 · Three.js 0.170.0 · GSAP 3.13 (ScrollTrigger + SplitText) · Lenis 1.1.0. Без React.

## Актуальное состояние (ноябрь 2026)

- На https://marjon.tech выложена версия **«Нить и техника»** (A+H): шаблон `src/page.mjs` + 3D-устройства `src/devices.js`, класс `html.v-ah`.
- `npm run build` — все варианты для просмотра (`/`, `/ah/`, `/e/ /f/ /g/ /h/`) в `dist/`.
- `npm run build:prod` — только боевая версия (RU в корне, UZ в `/uz/`) в `dist-prod/`; её содержимое кладётся в `~/marjon/landing` на сервере.
- Заявки из формы уходят POST-запросом на `/lead?t=<текст>`; nginx на сервере пересылает их Telegram-боту (токен хранится только на сервере, в `nginx/conf.d/lead-telegram.inc`, вне git). Если адрес недоступен — запасной путь через `mailto:`.
- Телефон: родная прокрутка, без 3D-устройств (только нить с бусинами), адаптив в `src/mobile.css`.
- Разделы ниже описывают первую версию и местами устарели.

## Запуск

```bash
npm install
npm run dev       # http://localhost:5173  (ru), /uz/ (uz)
npm run build     # → dist/ (статические файлы, можно класть за nginx как старый landing/)
npm run preview
```

## Где что

| Файл | Что внутри |
|---|---|
| `PRODUCT.md` | продукт, аудитория, разрешённые факты |
| `DESIGN.md` | визуальная вселенная, палитра, шрифты, шкала типографики, раскадровка 7 глав |
| `src/locales/ru.mjs`, `uz.mjs` | весь текст страницы |
| `src/page.mjs` | HTML-шаблон; `npm run pages` собирает из него `index.html` и `uz/index.html` (руками их не править) |
| `src/scene.js` | 3D: бусины, нить, свет, шейдеры, постобработка, cleanup |
| `src/story.js` | раскладки бусин и мастер-таймлайн (камера, объекты, uniform-ы) |
| `src/ui.js` | SplitText, появление блоков, счётчики, pin модулей, роли, меню |
| `src/main.js` | режимы, Lenis, привязка скролла ко времени таймлайна, единственный рендер-цикл |
| `public/poster*.jpg` | статичный постер; пересобрать: `node scripts/poster.mjs` при запущенном preview |
| `scripts/shots.mjs` | скриншоты глав на заданной ширине (нужен `npx playwright install chromium`) |

## Режимы

- **Полный** — WebGL, Lenis, scrub.
- **Постер** — нет WebGL2, ≤2 ядер, ≤2 ГБ памяти или Save-Data: 3D не грузится вообще (динамический import), вместо него `poster.jpg`. DOM-анимации остаются.
- **Статичный** — `prefers-reduced-motion`: постер, без Lenis и анимаций, все 8 модулей видны списком.
- **Без JS** — то же, что статичный.

Проверка руками: `?gl=0` выключает 3D, `?gl=1` включает принудительно, `?q=low` — мобильный профиль качества.


## Варианты (на согласование)

| URL | Вариант | Файлы |
|---|---|---|
| `/` | страница выбора | `src/chooser.mjs` |
| `/a/`, `/a/uz/` | A «Нить» | `src/page.mjs`, `src/style.css`, `src/scene.js`, `src/story.js`, `src/main.js`, `DESIGN.md` |
| `/d/`, `/d/uz/` | D «Стекло» (по референсам ruso.ru, lusion.co, liqium.ru) | `src/d/*`, `DESIGN-D.md` |

- Настоящие скриншоты интерфейса: `src/assets/shots/{pos,dash,mobile}.webp`.
- `src/core.js` — рантайм варианта D (режимы, Lenis на `gsap.ticker`, один рендер-цикл, мастер-таймлайн). Время сцены привязано к разметке: `data-t`, `data-t-bottom`, `data-cover`.
- `src/parts.mjs`, `src/shared.css` — общая разметка и база стилей варианта D.
- HTML-страницы (`index.html`, `a/`, `d/`) генерируются `npm run pages` и в git не хранятся.
- Постер D: `node scripts/poster2.mjs`; скриншоты для проверки: `node scripts/shots2.mjs d/ 1120 700 top problem modules+0.3`.
- В `main` репозитория сейчас лежит только вариант A (страницы в корне `/` и `/uz/`).

## Живое демо (общая секция A и D)

В варианте A секция «Платформы» со статичными скриншотами заменена живым демо из D: страница закрепляется, и настоящий интерфейс сам проходит сценарий «касса → кухня → телефон официанта → дашборд».

- `src/demo.mjs` — разметка, `src/demo.css` — стили, `src/demo.js` — scrub-таймлайн (`initDemo`).
- В A демо стоит перед бумажным блоком (`#platforms`), 3D-сцена под ним на паузе; цвета и шрифт заголовков переопределены в конце `src/style.css`.
- Без JS и при reduced-motion — четыре обычных блока с картинками.

# Marjon — лендинг «Нить» (3D scrollytelling)

Новый лендинг marjon.tech. Старый лежит рядом в `../landing/` и не тронут.

Стек: Vite 5 · Three.js 0.170.0 · GSAP 3.13 (ScrollTrigger + SplitText) · Lenis 1.1.0. Без React.

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

Скриншоты интерфейса в блоке «Платформы» — настоящие: `src/assets/shots/{pos,dash,mobile}.webp`.

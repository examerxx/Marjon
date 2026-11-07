import { Moon, Sun } from "lucide-react";
import { useRef } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../context/ThemeContext";

export default function TopbarThemeToggle() {
  const { theme, toggle } = useTheme();
  const { i18n } = useTranslation();
  const activeTransition = useRef(null);
  const dark = theme === "dark";
  const uzbek = (i18n.resolvedLanguage || i18n.language || "ru").startsWith("uz");
  const label = uzbek ? "Tungi mavzu" : "Тёмная тема";
  const title = uzbek
    ? dark ? "Yorug‘ mavzuni yoqish" : "Tungi mavzuni yoqish"
    : dark ? "Включить светлую тему" : "Включить тёмную тему";
  const ThemeIcon = dark ? Sun : Moon;

  function handleToggle(event) {
    const pending = activeTransition.current;
    if (pending) {
      pending.skipTransition();
      // Apply the second click once the first has committed, even if its
      // animation was interrupted before the new snapshot was taken.
      pending.updateCallbackDone.then(toggle, toggle);
      return;
    }

    if (!document.startViewTransition || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      toggle();
      return;
    }

    const root = document.documentElement;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.style.setProperty("--theme-reveal-origin", `${x}px ${y}px`);
    root.style.setProperty("--theme-reveal-radius", `${Math.ceil(radius) + 1}px`);
    root.classList.add("is-theme-revealing");

    const transition = document.startViewTransition(() => {
      flushSync(toggle);
    });
    activeTransition.current = transition;
    const cleanup = () => {
      activeTransition.current = null;
      root.classList.remove("is-theme-revealing");
      root.style.removeProperty("--theme-reveal-origin");
      root.style.removeProperty("--theme-reveal-radius");
    };
    // A skipped transition rejects ready, but still runs the theme update.
    transition.ready.catch(() => {});
    transition.finished.then(cleanup, cleanup);
  }

  return (
    <button
      type="button"
      className="topbar-theme-toggle"
      aria-label={label}
      aria-pressed={dark}
      title={title}
      onClick={handleToggle}
    >
      <ThemeIcon key={theme} size={22} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

import { t } from '../shared/i18n'

/**
 * BottomBar — плавающий нижний док. Все разделы режима приходят порталом;
 * в доке нет служебных индикаторов — только шесть крупных вкладок.
 */
export default function BottomBar() {
  return (
    <footer className="bottombar dock">
      <nav className="dock__nav" id="bottombar-nav-slot" aria-label={t('menu_more')} />
    </footer>
  )
}

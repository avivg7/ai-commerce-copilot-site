import { renderLangMenuHTML } from "../../../brand/js/lang-menu.js";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/config";
import { pagePath, type PageId } from "@/lib/requestRoutes";
import { withBase } from "@/lib/site";

/** ONE compact language control (globe + code + chevron + menu of real links). Behaviour: brand/js/lang-menu.js. */
export function LangMenu({
  locale, route, label, currentWord, idSuffix, block = false, up = false,
}: { locale: Locale; route: PageId; label: string; currentWord: string; idSuffix: string; block?: boolean; up?: boolean }) {
  const html = renderLangMenuHTML({
    id: `aicc-lang-${idSuffix}`,
    current: locale,
    items: LOCALES.map((l) => ({ locale: l, label: LOCALE_META[l].endonym, href: withBase(pagePath(l, route)), htmlLang: LOCALE_META[l].htmlLang })),
    short: LOCALE_META[locale].short,
    buttonLabel: `${label}: ${LOCALE_META[locale].endonym}, ${LOCALE_META[locale].short}`,
    currentWord,
    block,
    persist: true,
  });
  return <span style={{ display: block ? "block" : "inline-block" }} data-placement={up ? "up" : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}

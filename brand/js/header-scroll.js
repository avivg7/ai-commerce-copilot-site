// Fixed header: transparent at the top, blurred bar after 12px of scroll or while the mobile menu is open (live Navbar behaviour),
// plus the mobile menu disclosure (button -> panel; Esc and outside click close it and return focus).
// Markup contract: <header class="aicc-site-header" data-aicc-header> ... <button data-aicc-menu-btn aria-controls=ID aria-expanded=false>
// ... <div id=ID class="aicc-site-header__panel" data-aicc-menu-panel hidden>. All state lives in attributes, so server-rendered
// markup (React or PHP) and this script never fight over it.

export function initSiteHeader(header) {
  if (!header || header.dataset.aiccReady) return () => {};
  header.dataset.aiccReady = "1";
  const btn = header.querySelector("[data-aicc-menu-btn]");
  const panel = header.querySelector("[data-aicc-menu-panel]");
  const scrolled = () => header.setAttribute("data-scrolled", window.scrollY > 12 ? "true" : "false");
  scrolled();
  window.addEventListener("scroll", scrolled, { passive: true });

  const setOpen = (open, returnFocus) => {
    if (!btn || !panel) return;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    header.setAttribute("data-menu-open", open ? "true" : "false");
    if (!open && returnFocus) btn.focus();
  };
  const isOpen = () => btn?.getAttribute("aria-expanded") === "true";
  const onKey = (e) => {
    // A modal dialog (accessibility settings, video modal) handles its own Esc; never close the menu behind it.
    if (e.key === "Escape" && isOpen() && !document.querySelector("dialog[open]")) setOpen(false, true);
  };
  const onPointer = (e) => {
    if (isOpen() && !document.querySelector("dialog[open]") && !header.contains(e.target)) setOpen(false, false);
  };
  const mql = matchMedia("(min-width: 64rem)");
  const onMq = () => mql.matches && setOpen(false, false);
  btn?.addEventListener("click", () => setOpen(!isOpen(), false));
  panel?.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false, false);
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onPointer);
  mql.addEventListener("change", onMq);
  return () => {
    window.removeEventListener("scroll", scrolled);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onPointer);
    mql.removeEventListener("change", onMq);
  };
}

/** First focusable element on every page. Targets <main id="main">. */
export function SkipLink({ label }: { label: string }) {
  return (
    <a href="#main" className="aicc-skip">
      {label}
    </a>
  );
}

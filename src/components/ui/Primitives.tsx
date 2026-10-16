import type { ReactNode, ElementType } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

export function Container({
  children,
  narrow,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
  as?: ElementType;
}) {
  return <Tag className={cn("aicc-container", narrow && "aicc-container--narrow", className)}>{children}</Tag>;
}

export function Section({
  children,
  tone,
  id,
  labelledBy,
  className,
  tight,
}: {
  children: ReactNode;
  tone?: "surface" | "sunken" | "inverse";
  id?: string;
  labelledBy?: string;
  className?: string;
  tight?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "aicc-section",
        tight && "aicc-section--tight",
        tone && `aicc-section--${tone}`,
        tone === "inverse" && "aicc-on-dark",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  id,
  title,
  lead,
  level = 2,
  center,
  children,
}: {
  id?: string;
  title: ReactNode;
  lead?: ReactNode;
  level?: 1 | 2 | 3;
  center?: boolean;
  children?: ReactNode;
}) {
  const Tag = `h${level}` as ElementType;
  return (
    <div className={cn("aicc-heading", center && "aicc-heading--center")}>
      <Tag id={id} className={level === 1 ? "aicc-display" : "aicc-h2"}>
        {title}
      </Tag>
      {lead ? <p className="aicc-lead">{lead}</p> : null}
      {children}
    </div>
  );
}

export function Card({
  children,
  className,
  lift,
  inverse,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  lift?: boolean;
  inverse?: boolean;
  as?: ElementType;
}) {
  return <Tag className={cn("aicc-card", lift && "aicc-card--lift", inverse && "aicc-card--inverse", className)}>{children}</Tag>;
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "brand";
  className?: string;
}) {
  return <span className={cn("aicc-badge", tone !== "neutral" && `aicc-badge--${tone}`, className)}>{children}</span>;
}

export function Banner({
  children,
  tone = "info",
  className,
  role,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "danger";
  className?: string;
  role?: "status" | "alert" | "note";
}) {
  const Icon = tone === "info" ? Info : TriangleAlert;
  return (
    <div className={cn("aicc-banner", tone !== "info" && `aicc-banner--${tone}`, className)} role={role}>
      <Icon className="aicc-banner__icon" size={20} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/**
 * Form field: visible label, optional hint and error, wired with aria-describedby / aria-invalid.
 * The control is rendered by the caller via the render prop so any input/select can be used.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (a: { id: string; "aria-describedby": string; "aria-invalid": boolean; className: string }) => ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errId = `${id}-error`;
  const described = [hint ? hintId : "", error ? errId : ""].filter(Boolean).join(" ");
  return (
    <div className="aicc-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": described, "aria-invalid": !!error, className: "aicc-field__control" })}
      {hint ? (
        <p id={hintId} className="aicc-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="aicc-field__error" role="alert">
          <TriangleAlert size={18} aria-hidden="true" style={{ flex: "none", marginBlockStart: 2 }} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "quiet";

interface CommonProps {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  className?: string;
  children: ReactNode;
  /** Trailing icon; it nudges 2px on hover (legacy behaviour). */
  icon?: ReactNode;
}

type LinkProps = CommonProps & { href: string; onClick?: () => void };
type ButtonProps = CommonProps & {
  href?: undefined;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
};

function classes({ variant = "outline", size = "md", block, className }: CommonProps) {
  return cn(
    "aicc-btn",
    variant === "primary" && "aicc-btn--primary",
    variant === "secondary" && "aicc-btn--secondary",
    variant === "outline" && "aicc-btn--outline",
    variant === "ghost" && "aicc-btn--ghost",
    variant === "quiet" && "aicc-btn--quiet",
    size === "lg" && "aicc-btn--lg",
    size === "sm" && "aicc-btn--sm",
    block && "aicc-btn--block",
    className,
  );
}

/**
 * Button: the brand kit's .aicc-btn (exact legacy primary gradient/shadow/hover, glass secondary). Renders a link when `href` is given
 * (internal hrefs use next/link and get basePath), otherwise a <button>.
 */
export function Button(props: LinkProps | ButtonProps) {
  const inner = (
    <>
      {props.children}
      {props.icon ? <span className="aicc-btn__icon">{props.icon}</span> : null}
    </>
  );
  if (props.href !== undefined) {
    const { href, onClick } = props;
    if (/^(https?:|mailto:)/.test(href)) {
      return (
        <a href={href} className={classes(props)} onClick={onClick}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} className={classes(props)} onClick={onClick}>
        {inner}
      </Link>
    );
  }
  const { type = "button", disabled, onClick } = props;
  return (
    <button type={type} className={classes(props)} disabled={disabled} onClick={onClick} aria-label={props["aria-label"]}>
      {inner}
    </button>
  );
}

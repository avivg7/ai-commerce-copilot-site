import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "quiet";

interface CommonProps {
  variant?: Variant;
  size?: "md" | "lg";
  block?: boolean;
  className?: string;
  children: ReactNode;
}

type LinkProps = CommonProps & { href: string; onClick?: () => void };
type ButtonProps = CommonProps & {
  href?: undefined;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
};

function classes({ variant = "secondary", size = "md", block, className }: CommonProps) {
  return cn(
    "aicc-btn",
    variant === "primary" && "aicc-btn--primary",
    variant === "ghost" && "aicc-btn--ghost",
    variant === "quiet" && "aicc-btn--quiet",
    size === "lg" && "aicc-btn--lg",
    block && "aicc-btn--block",
    className,
  );
}

/**
 * Button. Renders a link when `href` is given (internal hrefs use next/link and get basePath), otherwise a <button>.
 * States: hover lift, focus-visible ring (tokens), active press, disabled. Min 44px tall.
 */
export function Button(props: LinkProps | ButtonProps) {
  if (props.href !== undefined) {
    const { href, onClick, children } = props;
    const external = /^(https?:|mailto:)/.test(href);
    if (external) {
      return (
        <a href={href} className={classes(props)} onClick={onClick}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={classes(props)} onClick={onClick}>
        {children}
      </Link>
    );
  }
  const { type = "button", disabled, onClick, children } = props;
  return (
    <button
      type={type}
      className={classes(props)}
      disabled={disabled}
      onClick={onClick}
      aria-label={props["aria-label"]}
    >
      {children}
    </button>
  );
}

import type { ReactNode } from "react";

interface TooltipProps {
  label: string;
  className?: string;
  children: ReactNode;
}

/** Instant tooltip wrapper; works when the child control is disabled. */
export function Tooltip({ label, className, children }: TooltipProps) {
  const rootClass = ["tooltip", className].filter(Boolean).join(" ");

  return (
    <span className={rootClass}>
      {children}
      <span className="tooltip__label" role="tooltip">
        {label}
      </span>
    </span>
  );
}

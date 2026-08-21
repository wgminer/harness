import type { HTMLAttributes } from "react";

type SkeletonProps = {
  /** Accessible name when this bar is the sole wait affordance. */
  label?: string;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

/** Shared pulsing placeholder bar — size via `ui-skeleton--*` modifiers. */
export function Skeleton({ label, className, ...rest }: SkeletonProps) {
  const classes = ["ui-skeleton", className].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    />
  );
}

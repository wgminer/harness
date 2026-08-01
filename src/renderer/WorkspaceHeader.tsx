import type { ReactNode } from "react";

interface WorkspaceHeaderProps {
  title: string;
  icon?: ReactNode;
  className?: string;
  innerClassName?: string;
  titleRowClassName?: string;
  titleClassName?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

function joinClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function WorkspaceHeader({
  title,
  icon,
  className,
  innerClassName,
  titleRowClassName,
  titleClassName,
  actions,
  children,
}: WorkspaceHeaderProps) {
  return (
    <header className={joinClassNames("workspace-header", className)}>
      <div className={joinClassNames("workspace-header-inner", innerClassName)}>
        <div className={joinClassNames("workspace-header-title-row", titleRowClassName)}>
          {icon}
          <h1 className={joinClassNames("workspace-title", titleClassName)}>{title}</h1>
        </div>
        {actions}
      </div>
      {children}
    </header>
  );
}

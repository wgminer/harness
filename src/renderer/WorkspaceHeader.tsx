import type { ReactNode } from "react";

interface WorkspaceHeaderProps {
  title: string;
  icon?: ReactNode;
  scrolled?: boolean;
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
  scrolled = false,
  className,
  innerClassName,
  titleRowClassName,
  titleClassName,
  actions,
  children,
}: WorkspaceHeaderProps) {
  return (
    <header className={joinClassNames("workspace-header", scrolled && "workspace-header--scrolled", className)}>
      <div className={joinClassNames("workspace-header-inner", innerClassName)}>
        <div className={joinClassNames("workspace-header-title-row", titleRowClassName)}>
          {icon}
          <h2 className={joinClassNames("workspace-title", titleClassName)}>{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </header>
  );
}

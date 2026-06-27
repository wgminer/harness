import { Search } from "lucide-react";

interface WorkspaceListSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  "aria-label": string;
}

export function WorkspaceListSearch({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
}: WorkspaceListSearchProps) {
  return (
    <div className="workspace-list-search">
      <Search size={14} strokeWidth={2} className="workspace-list-search__icon" aria-hidden />
      <input
        type="search"
        className="workspace-list-search__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
    </div>
  );
}

import { type Ref } from "react";
import { Search } from "lucide-react";

interface WorkspaceListSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  "aria-label": string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

export function WorkspaceListSearch({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  autoFocus = false,
  inputRef,
}: WorkspaceListSearchProps) {
  return (
    <div className="workspace-list-search">
      <Search size={14} strokeWidth={2} className="workspace-list-search__icon" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        className="workspace-list-search__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
      />
    </div>
  );
}

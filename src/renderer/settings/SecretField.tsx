import { useState, type ChangeEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

export interface SecretFieldProps {
  id: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  ariaLabel: string;
  testId?: string;
}

export function SecretField({
  id,
  value,
  onChange,
  onBlur,
  ariaLabel,
  testId,
}: SecretFieldProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="settings-api-key-row">
      <input
        id={id}
        data-testid={testId}
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete="off"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore="true"
        aria-label={ariaLabel}
      />
      <button
        type="button"
        className="btn btn-icon"
        aria-pressed={show}
        aria-label={show ? `Hide ${ariaLabel}` : `Show ${ariaLabel}`}
        title={show ? "Hide key" : "Show key"}
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

// components/ToastProvider.jsx
import { createContext, useContext, useState } from "react";
import "./Toast.scss";

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ show: false, message: "" });

  const showToast = (message) => {
    setToast({ show: true, message });
    setTimeout(() => setToast({ show: false, message: "" }), 2000);
  };

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast.show && <div className="toast">{toast.message}</div>}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

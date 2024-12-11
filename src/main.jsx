import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./main.scss";
import "./utils.scss";
import App from "./components/App.jsx";

import { ToastProvider } from "./components/ToastProvider";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);

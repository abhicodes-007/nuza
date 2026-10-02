import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { installWebviewLockdown } from "./lib/webviewLockdown";

// Before anything is drawn: no right click should ever have offered a browser's menu.
installWebviewLockdown();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

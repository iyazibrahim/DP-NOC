import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { AuthProvider } from "./auth/AuthContext";
import { CommandCenterProvider } from "./commandCenter/CommandCenterContext";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CommandCenterProvider>
          <App />
        </CommandCenterProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

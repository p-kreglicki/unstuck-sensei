import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { DetectionProvider } from "./hooks/useDetection";
import { DetectionSyncBridge } from "./hooks/useDetectionSync";
import "./main.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <DetectionProvider>
        <DetectionSyncBridge />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DetectionProvider>
    </AuthProvider>
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles/globals.css";
import { App } from "./app/App";
import { ErrorBoundary } from "@sentry/react";
import { initializeObservability } from "./observability";
initializeObservability();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={
        <p role="alert">
          Unable to display this page. Please refresh to retry.
        </p>
      }
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

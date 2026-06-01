import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

// Apply saved theme before first paint to avoid flash
(() => {
  try {
    const saved = localStorage.getItem("yoke-theme");
    const valid = new Set([
      "dark",
      "light",
      "arcade",
      "deep-blue",
      "enterprise",
      "newsprint",
      "lcars",
      "synthwave",
      "botanical",
      "slate",
      "rose",
      "high-contrast",
    ]);
    const theme = saved && valid.has(saved) ? saved : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import AboutPage from "./components/AboutPage";
import CliPage from "./components/CliPage";
import DocsPage from "./components/DocsPage";
import PrivacyPage from "./components/PrivacyPage";
import TermsPage from "./components/TermsPage";
import ToolsPage from "./components/ToolsPage";
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

/** Route static pages before App to avoid hooks-order violations in App. */
function Router() {
  const path = window.location.pathname;
  if (path === "/cli") return <CliPage />;
  if (path === "/about") return <AboutPage />;
  if (path === "/docs") return <DocsPage />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/terms") return <TermsPage />;
  if (path === "/tools") return <ToolsPage />;
  return <App />;
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  </StrictMode>,
);

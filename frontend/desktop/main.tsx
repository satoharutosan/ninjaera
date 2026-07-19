import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import "./desktop.css";
import DesktopApp from "./DesktopApp";
import { DesktopErrorBoundary } from "./shell/DesktopErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <DesktopErrorBoundary>
    <DesktopApp />
  </DesktopErrorBoundary>,
);

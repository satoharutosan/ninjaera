import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { migrateHashToPath } from "./shared/routing";
import "./styles/index.css";

migrateHashToPath();

createRoot(document.getElementById("root")!).render(<App />);

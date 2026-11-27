import { createRoot } from "react-dom/client";
import { adminBackendConfigured } from "./admin-api.ts";
import { OwnerAdmin } from "./owner-admin.tsx";
import { AdminPreviewProof } from "./preview-proof.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Brak elementu głównego panelu.");
const local = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
createRoot(root).render(adminBackendConfigured() ? <OwnerAdmin /> : local ? <AdminPreviewProof /> : <main>
  <h1>Panel administratora</h1>
  <p role="alert">Panel nie ma skonfigurowanego połączenia z serwerem.</p>
</main>);

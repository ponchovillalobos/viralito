import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest config para que el alias `@/` (definido en tsconfig.json paths) funcione
// dentro de los tests. Sin esto, `import { foo } from "@/lib/x"` falla en runtime
// porque vitest no lee tsconfig paths automáticamente.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // globals:true para que @testing-library/react registre su afterEach(cleanup)
    // automático (sin esto el DOM de un test se filtra al siguiente). No rompe las
    // suites que importan describe/it/expect explícitamente.
    globals: true,
    // La mayoría de las suites corren en Node (lógica pura). Las pruebas de
    // componentes React (setup-gate, slider) declaran `// @vitest-environment jsdom`
    // en su cabecera, así no pagamos el costo de jsdom en las suites de lógica.
    // El setup global sólo registra los matchers de jest-dom (toHaveAttribute, etc.).
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // No colectar tests de los artefactos de build (next copia src/ a .next/standalone,
    // duplicando cada *.test → falsos fallos). node_modules/dist ya los excluye vitest.
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
  },
});

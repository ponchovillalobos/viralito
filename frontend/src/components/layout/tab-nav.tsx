"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { SettingsDialog } from "@/components/layout/settings-dialog";

// Header minimalista: SOLO marca (vuelve a Inicio) + Configuración. Los enlaces
// de sección (Crear video / Videos largos / Mis videos) se quitaron — duplicaban
// las tarjetas de la home, que ahora son el único menú (decisión del usuario
// 2026-06). El logo siempre lleva a Inicio (el hub con las tarjetas).
export function TabNav() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Permite abrir Configuración desde cualquier parte (p.ej. el checklist de la
  // home dispara `window.dispatchEvent(new CustomEvent("open-settings"))`).
  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener("open-settings", openSettings);
    return () => window.removeEventListener("open-settings", openSettings);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-7xl items-center gap-1 px-4 py-3 sm:px-6">
        <Link href="/" className="group mr-2 flex items-center gap-2 sm:mr-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/viralito-64.png"
            alt="Viralito"
            className="h-7 w-7 rounded-lg shadow-[0_0_18px_rgba(250,60,141,0.45)] transition-transform group-hover:scale-110"
          />
          <span className="bg-gradient-to-r from-[#fa3c8d] to-[#ad23ee] bg-clip-text text-sm font-bold tracking-tight text-transparent">
            Viralito
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-md p-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="Configurar cuentas de redes sociales"
            aria-label="Configurar cuentas de redes sociales"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden lg:inline">Configuración</span>
          </button>
        </div>
      </nav>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  );
}

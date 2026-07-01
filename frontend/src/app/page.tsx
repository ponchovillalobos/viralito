import Link from "next/link";
import { Scissors, ArrowRight, Telescope, Film, Clapperboard, CalendarClock } from "lucide-react";
import { OnboardingModal, OnboardingTourLink } from "@/components/home/onboarding-modal";

export const dynamic = "force-dynamic";

// Menú principal: las tarjetas son el ÚNICO menú (el nav de arriba se redujo a
// marca + Configuración). Cada tarjeta lleva su propio color de identidad.
const ACTIONS = [
  {
    href: "/editor/wizard",
    title: "Crear un video corto",
    desc: "Sube un video y conviértelo en un short viral, paso a paso.",
    icon: Scissors,
    color: "#06b6d4", // cyan
  },
  {
    href: "/largos",
    title: "Cortar un video largo",
    desc: "Sube un curso o charla y la IA extrae los mejores clips virales.",
    icon: Film,
    color: "#ad23ee", // violeta
  },
  {
    href: "/editor/wizard?style=cinematic_pro",
    title: "Video cinematográfico",
    desc: "Sube tu video (y opcionalmente imágenes) — la IA lo edita con look de cine: grano, color y movimientos de cámara.",
    icon: Clapperboard,
    color: "#e11d48", // rojo "alfombra roja"
  },
  {
    href: "/publicar",
    title: "Publicar y mis videos",
    desc: "Tus videos listos + calendario: elige red, fecha y hora, y deja todo programado.",
    icon: CalendarClock,
    color: "#10b981", // emerald
  },
] as const;

const SECONDARY = [
  { href: "/research", label: "Buscar inspiración (analizar virales ajenos)", icon: Telescope },
] as const;

export default function Home() {
  return (
    <>
      {/* Tour de bienvenida (solo la primera vez; client component que se abre solo).
          Va FUERA del div space-y-10 para que su overlay fixed no herede márgenes
          ni desplace el layout al aparecer. */}
      <OnboardingModal />

      <div className="space-y-10">
      {/* Hero */}
      <header className="relative space-y-3 pt-4">
        {/* Resplandor sutil detrás del título — eleva el "preciosa visualmente" sin distraer. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 left-0 -z-10 h-64 w-[28rem] max-w-full rounded-full bg-primary/20 opacity-50 blur-3xl"
        />
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Hola 👋 ¿Qué quieres hacer hoy?
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Convierte tus videos en{" "}
          <strong className="text-brand-gradient drop-shadow-[0_0_18px_rgba(250,60,141,0.35)]">
            shorts virales
          </strong>{" "}
          y publícalos en tus redes — sin saber editar. Elige una opción para empezar.
        </p>
      </header>

      {/* Menú principal — solo 4 acciones: tarjetas GRANDES y visuales (2×2), cada una
          con su color de identidad. Llenan la pantalla para que se elija sin dudar. */}
      <div className="grid gap-5 sm:grid-cols-2">
        {ACTIONS.map(({ href, title, desc, icon: Icon, color }) => (
          <Link
            key={href}
            href={href}
            className="group relative flex min-h-[220px] flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
            style={{ borderColor: `${color}40`, backgroundColor: `${color}0d` }}
          >
            {/* Glow del color de la tarjeta al pasar el mouse. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-30"
              style={{ backgroundColor: color }}
            />
            {/* Sheen sutil que cruza al pasar el mouse — efecto "preciosa". */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />

            <span
              className="relative flex h-16 w-16 items-center justify-center rounded-2xl text-white transition-transform duration-300 group-hover:scale-110"
              style={{ backgroundColor: color, boxShadow: `0 8px 24px -8px ${color}` }}
            >
              <Icon className="h-8 w-8" />
            </span>
            <div className="relative space-y-1.5">
              <h2 className="text-2xl font-semibold">{title}</h2>
              <p className="text-base text-muted-foreground">{desc}</p>
            </div>
            <span
              className="relative mt-auto flex items-center gap-1.5 text-base font-medium"
              style={{ color }}
            >
              Empezar
              <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>

      {/* Accesos secundarios */}
      <div className="flex flex-wrap gap-2">
        {SECONDARY.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/50 hover:text-foreground hover:shadow-md hover:shadow-primary/5"
          >
            <Icon className="h-4 w-4 transition-colors group-hover:text-primary" />
            {label}
          </Link>
        ))}
      </div>

      {/* Pie discreto: volver a ver el tour de bienvenida */}
      <div className="flex justify-center pb-2">
        <OnboardingTourLink />
      </div>
      </div>
    </>
  );
}

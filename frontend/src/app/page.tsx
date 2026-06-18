import Link from "next/link";
import { Scissors, FolderKanban, ArrowRight, Upload, Wand2, Sparkles, Send, Telescope, Film, Clapperboard } from "lucide-react";
import { GettingStarted } from "@/components/home/getting-started";
import { OnboardingModal, OnboardingTourLink } from "@/components/home/onboarding-modal";

export const dynamic = "force-dynamic";

const ACTIONS = [
  {
    href: "/editor/wizard",
    title: "Crear un video corto",
    desc: "Sube un video y conviértelo en un short viral, paso a paso.",
    icon: Scissors,
    primary: true,
  },
  {
    href: "/largos",
    title: "Cortar un video largo",
    desc: "Sube un curso o charla y la IA extrae los mejores clips virales.",
    icon: Film,
    primary: false,
  },
  {
    href: "/editor/wizard?style=cinematic_pro",
    title: "Video cinematográfico",
    desc: "Sube tu video (y opcionalmente imágenes) — la IA lo edita con look de cine: grano, color y movimientos de cámara.",
    icon: Clapperboard,
    primary: false,
  },
  {
    href: "/produccion",
    title: "Ver mis videos",
    desc: "Tus shorts ya editados, listos para publicar.",
    icon: FolderKanban,
    primary: false,
  },
] as const;

const FLOW = [
  { icon: Upload, label: "Subes tu video" },
  { icon: Wand2, label: "Eliges un estilo" },
  { icon: Sparkles, label: "Se genera solo" },
  { icon: Send, label: "Publicas en tus redes" },
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

      {/* 3 acciones principales ("Mis resultados" bajó a la fila secundaria) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACTIONS.map(({ href, title, desc, icon: Icon, primary }) => (
          <Link
            key={href}
            href={href}
            className={`group relative flex flex-col gap-3 overflow-hidden rounded-xl border p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${
              primary
                ? "border-primary/40 bg-primary/10 hover:border-primary hover:shadow-primary/20"
                : "border-border bg-card hover:border-primary/40 hover:shadow-primary/10"
            }`}
          >
            {/* Sheen sutil que aparece al pasar el mouse — efecto "preciosa". */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />

            <span
              className={`relative flex h-11 w-11 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110 ${
                primary
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                  : "bg-muted text-foreground group-hover:bg-primary/15 group-hover:text-primary"
              }`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="relative space-y-1">
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
            <span className="relative mt-auto flex items-center gap-1 text-sm font-medium text-primary">
              Empezar
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>

      {/* Cómo funciona — 4 pasos */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Cómo funciona
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {FLOW.map(({ icon: Icon, label }, i) => (
            <div key={label} className="flex flex-1 items-center gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-sm font-semibold text-primary ring-1 ring-primary/30 shadow-sm shadow-primary/10">
                  {i + 1}
                </span>
                <span className="flex items-center gap-1.5 text-sm">
                  <Icon className="h-4 w-4 text-primary/80" />
                  {label}
                </span>
              </div>
              {i < FLOW.length - 1 && (
                <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/40 sm:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Primeros pasos (checklist que se tilda solo) */}
      <GettingStarted />

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

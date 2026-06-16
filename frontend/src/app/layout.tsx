import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TabNav } from "@/components/layout/tab-nav";
import { Toaster } from "@/components/ui/sonner";
import { NotificationPoller } from "@/components/layout/notification-poller";
import { QueuePanel } from "@/components/jobs/queue-panel";
import { SetupBanner } from "@/components/layout/setup-banner";
import { UpdateBanner } from "@/components/layout/update-banner";

// Inter — sans-serif moderna y muy legible, estándar de UI (Figma, Linear, Notion).
// Cargamos los weights variables para títulos (700/800) y cuerpo (400/500/600).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Geist Mono se mantiene para `.font-mono-tab` (números tabulares en métricas,
// timestamps, IDs). Tiene tnum y un look monospaceado coherente.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Viralito",
  description:
    "Convierte tus videos en shorts virales — 100% en tu compu, sin saber editar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TabNav />
        <SetupBanner />
        <UpdateBanner />
        <main className="flex-1 mx-auto w-full max-w-7xl px-6 py-6">
          {children}
        </main>
        <Toaster theme="dark" position="top-right" />
        <NotificationPoller />
        <QueuePanel />
      </body>
    </html>
  );
}

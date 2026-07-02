"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Notification {
  id: string;
  type:
    | "instagram_due"
    | "tiktok_failed"
    | "linkedin_failed"
    // Fallo definitivo de publicación en cualquier otra red (facebook, etc.).
    | "publish_failed"
    // Emitidos por job-store cuando una edición termina (bien o mal).
    | "render_done"
    | "render_failed";
  projectId: string;
  scheduleId?: string;
  scheduledAt: number;
  message?: string;
  ack: boolean;
  createdAt: number;
}

const POLL_INTERVAL_MS = 15_000;

/**
 * Monta este componente en el root layout. Cada 15s pregunta a /api/notifications
 * por items pendientes. Cuando aparece uno nuevo desde la última visita:
 *   - dispara toast.warning con action "Abrir bridge"
 *   - reproduce un beep corto para llamar atención
 *   - marca como ack para no volver a notificar
 */
export function NotificationPoller() {
  const router = useRouter();
  const seenIds = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Beep generado vía WebAudio para no depender de assets en /public
    if (typeof window !== "undefined" && !audioRef.current) {
      try {
        const beepUrl = makeBeepDataUrl();
        audioRef.current = new Audio(beepUrl);
        audioRef.current.volume = 0.6;
      } catch {
        // sin audio, sigue funcionando
      }
    }

    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok) return;
        const data = (await res.json()) as { notifications: Notification[] };
        for (const n of data.notifications) {
          if (seenIds.current.has(n.id)) continue;
          seenIds.current.add(n.id);
          showNotification(n);
          // Ack inmediato para no volver a mostrar en el próximo tick
          fetch("/api/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: n.id }),
          }).catch(() => {});
        }
      } catch {
        // silenciosamente — esto corre cada 15s, no queremos spamear errores
      }
      if (!cancelled) {
        setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    // Primer tick rápido (3s después de mount) para no esperar 15s al boot
    const initial = setTimeout(tick, 3000);

    function showNotification(n: Notification) {
      try {
        audioRef.current?.play().catch(() => {});
      } catch {
        // ignore
      }
      const time = new Date(n.scheduledAt).toLocaleTimeString("es", {
        hour: "2-digit",
        minute: "2-digit",
      });
      if (n.type === "instagram_due") {
        toast.warning(`📸 Hora de subir a Instagram: ${n.projectId} (${time})`, {
          duration: 30_000,
          action: {
            label: "Abrir bridge",
            onClick: () => {
              router.push("/produccion");
              // El usuario abre manualmente el botón IG de la card.
              // Posible mejora futura: deep link con query param que auto-abra el dialog.
            },
          },
        });
      } else if (n.type === "tiktok_failed") {
        toast.error(`No se pudo publicar en TikTok: ${n.projectId}`, {
          description: n.message ?? "Intenta de nuevo desde Mis videos.",
          duration: 20_000,
        });
      } else if (n.type === "linkedin_failed") {
        toast.error(`No se pudo publicar en LinkedIn: ${n.projectId}`, {
          description: n.message ?? "Intenta de nuevo desde Mis videos.",
          duration: 20_000,
        });
      } else if (n.type === "publish_failed") {
        toast.error(`No se pudo publicar: ${n.projectId}`, {
          description: n.message ?? "Intenta de nuevo desde Mis videos.",
          duration: 20_000,
        });
      } else if (n.type === "render_done") {
        // n.message trae el título humano del video (o el id si no hay título).
        toast.success("¡Tu video está listo! 🎉", {
          description: n.message,
          duration: 15_000,
          action: {
            label: "Verlo",
            onClick: () => router.push("/produccion"),
          },
        });
      } else if (n.type === "render_failed") {
        // n.message trae el motivo humano del fallo.
        const motivo = n.message ?? "Algo salió mal al generar el video. Intenta de nuevo.";
        toast.error("Tu video no se pudo crear", {
          duration: 20_000,
          action: {
            label: "Ver por qué",
            onClick: () => {
              toast.error("Esto fue lo que pasó", {
                description: motivo,
                duration: 30_000,
              });
            },
          },
        });
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [router]);

  return null;
}

/**
 * Genera un beep corto (200ms, 880Hz senoidal con fade out) como data URL WAV.
 * Suficientemente liviano y evita necesitar un archivo en /public.
 */
function makeBeepDataUrl(): string {
  const sampleRate = 22050;
  const durationSec = 0.18;
  const frequency = 880;
  const samples = Math.floor(sampleRate * durationSec);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);

  function writeStr(offset: number, s: string) {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  }
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples * 2, true);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = Math.max(0, 1 - t / durationSec);
    const sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.35;
    view.setInt16(44 + i * 2, sample * 0x7fff, true);
  }

  // Convert buffer to base64 (works in browser without external deps)
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length)))
    );
  }
  return `data:audio/wav;base64,${typeof btoa !== "undefined" ? btoa(binary) : ""}`;
}

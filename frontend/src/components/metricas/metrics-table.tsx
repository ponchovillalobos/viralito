"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRealMetrics } from "@/hooks/use-real-metrics";
import { PLATFORMS, PLATFORM_ORDER } from "@/lib/platforms";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

function formatNumber(n: number | undefined) {
  if (n === undefined || n === null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return n.toString();
}

export function MetricsTable() {
  const { store, hydrated, removeEntry, clearPlatform } = useRealMetrics();

  if (!hydrated) {
    return (
      <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
        Cargando…
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {PLATFORM_ORDER.map((key) => {
        const p = PLATFORMS[key];
        const entries = store[key];
        return (
          <Card key={key} className="border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: p.color }}
                />
                <h3 className="text-base font-medium">{p.label}</h3>
                <span className="font-mono-tab text-xs text-muted-foreground">
                  {entries.length} entrada{entries.length === 1 ? "" : "s"}
                </span>
              </div>
              {entries.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`¿Borrar todas las entradas de ${p.label}?`)) {
                      clearPlatform(key);
                      toast.success(`${p.label}: entradas borradas`);
                    }
                  }}
                  className="text-xs text-muted-foreground hover:text-red-400"
                >
                  Borrar todo
                </Button>
              )}
            </div>

            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin datos. Agrega una entrada arriba.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Día</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Views</TableHead>
                      <TableHead className="text-right">Likes</TableHead>
                      <TableHead className="text-right">Comments</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">Follows</TableHead>
                      {key === "instagram" && (
                        <TableHead className="text-right">Saves</TableHead>
                      )}
                      <TableHead>Notas</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono-tab">
                          D{e.day.toString().padStart(2, "0")}
                        </TableCell>
                        <TableCell className="font-mono-tab text-xs text-muted-foreground">
                          {e.date ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono-tab">
                          {formatNumber(e.views)}
                        </TableCell>
                        <TableCell className="text-right font-mono-tab">
                          {formatNumber(e.likes)}
                        </TableCell>
                        <TableCell className="text-right font-mono-tab">
                          {formatNumber(e.comments)}
                        </TableCell>
                        <TableCell className="text-right font-mono-tab">
                          {formatNumber(e.shares)}
                        </TableCell>
                        <TableCell className="text-right font-mono-tab">
                          {e.follows !== undefined ? `+${e.follows}` : "—"}
                        </TableCell>
                        {key === "instagram" && (
                          <TableCell className="text-right font-mono-tab">
                            {formatNumber(e.saves)}
                          </TableCell>
                        )}
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {e.notes ?? "—"}
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => {
                              removeEntry(key, e.id);
                              toast.success("Entrada borrada");
                            }}
                            aria-label={`Borrar la entrada D${e.day.toString().padStart(2, "0")}`}
                            title={`Borrar la entrada D${e.day.toString().padStart(2, "0")}`}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

import { WizardClient } from "@/components/editor/wizard/wizard-client";

export default async function WizardPage({
  searchParams,
}: {
  searchParams: Promise<{ style?: string }>;
}) {
  // La home puede enlazar /editor/wizard?style=cinematic_pro (tarjeta
  // "Cinematográfico") para que el wizard arranque con ese estilo elegido.
  const { style } = await searchParams;
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="font-mono-tab text-xs uppercase tracking-wider text-muted-foreground">
          Crea tu video
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Edita tu video paso a paso</h1>
        <p className="max-w-2xl text-muted-foreground">
          Elige tu video, un estilo y un color — la app crea todo por ti, hasta la
          descripción para tus redes. Si eliges 2-3 estilos, te crea todos para que compares.
        </p>
      </header>

      <WizardClient initialStyle={style} />
    </div>
  );
}

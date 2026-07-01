import { redirect } from "next/navigation";

// La vieja página "Mis videos" fue absorbida por la sección "Programar y publicar" (/publicar),
// que ahora es el hub único: calendario + composer + tus videos. Redirigimos para no romper
// links/bookmarks viejos. La lista de videos vive en /publicar (mismo ProductionList).
export default function ProduccionPage() {
  redirect("/publicar");
}

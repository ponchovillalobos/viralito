// Los 20 temas editoriales, en UN solo lugar.
//
// Estaban escritos dos veces —una por wizard— con los mismos 20 temas en
// distinto orden, y con una diferencia que sí se veía: la copia de largos no
// tenía `hint`, así que quien procesaba un video largo elegía entre 20 temas
// sin una línea que explicara qué era cada uno. Nadie iba a notar que faltaba;
// simplemente se elegía peor.
//
// El orden de este archivo es el que ven los dos wizards, y los primeros 8 son
// los que se muestran antes de "ver todos", así que el orden es una decisión de
// producto, no cosmética.
//
// Campos: `theme`/`font`/`background` es lo que viaja al render; `bg`, `text`,
// `demoFont` y `accent` son para la mini-vista-previa de la tarjeta; `hint` es
// la línea que lee la persona.

export const EDITORIAL_THEMES = [
  { id: "clasico", name: "Clásico", hint: "Elegante y serio, estilo documental", theme: "", font: "playfair", background: "dark", bg: "#0a0908", text: "#f3ede1", demoFont: "Georgia, serif" },
  { id: "ft", name: "FT salmón", hint: "Rosa salmón de periódico financiero", theme: "ft", accent: "#0d7680", font: "lora", background: "cream", bg: "#fff1e5", text: "#33302e", demoFont: "'Franklin Gothic Medium', sans-serif" },
  { id: "vogue", name: "Vogue noir", hint: "Negro con dorado, revista de lujo", theme: "vogue", accent: "#c9a96a", font: "bodoni", background: "dark", bg: "#0c0b0a", text: "#f4f0e6", demoFont: "'Didot', 'Bodoni MT', serif" },
  { id: "riso", name: "Zine riso", hint: "Fanzine rebelde, rosa neón", theme: "riso", accent: "#FF48B0", font: "abril", background: "cream", bg: "#f1ece0", text: "#141414", demoFont: "'Arial Black', sans-serif" },
  { id: "stripe", name: "Stripe press", hint: "Azul tech de manual fino", theme: "stripe", accent: "#635bff", font: "newsreader", background: "ink", bg: "#0a2540", text: "#f6f9fc", demoFont: "Georgia, serif" },
  { id: "prensa", name: "Prensa 1900", hint: "Periódico antiguo, tinta roja", theme: "prensa", accent: "#8e2a1e", font: "playfair", background: "cream", bg: "#e8e1cf", text: "#1c1812", demoFont: "'Times New Roman', serif" },
  { id: "swiss", name: "Suizo grid", hint: "Blanco, orden, toque rojo", theme: "swiss", accent: "#e30613", font: "lora", background: "cream", bg: "#f4f4f1", text: "#0d0d0d", demoFont: "'Helvetica', 'Arial', sans-serif" },
  { id: "bold", name: "Bold", hint: "Letras gruesas que gritan", theme: "", font: "abril", background: "dark", bg: "#0a0908", text: "#f3ede1", demoFont: "'Arial Black', serif" },
  { id: "tinta", name: "Tinta", hint: "Azul noche, sobrio", theme: "", font: "dmserif", background: "ink", bg: "#0a0f16", text: "#e9eef5", demoFont: "'Times New Roman', serif" },
  { id: "crema", name: "Crema", hint: "Claro y cálido, se siente caro", theme: "", font: "lora", background: "cream", bg: "#f5efe3", text: "#1c1611", demoFont: "Georgia, serif" },
  { id: "kinfolk", name: "Kinfolk calma", hint: "Minimalista, tonos tierra", theme: "kinfolk", accent: "#b06b4c", font: "lora", background: "cream", bg: "#f6f3ec", text: "#33302a", demoFont: "'Garamond', serif" },
  { id: "grabado", name: "Grabado", hint: "Ilustración antigua, sepia", theme: "grabado", accent: "#8a6d3b", font: "playfair", background: "cream", bg: "#ece3cd", text: "#2a2118", demoFont: "'Book Antiqua', serif" },
  { id: "constructivista", name: "Constructivista", hint: "Cartel ruso: rojo y diagonales", theme: "constructivista", accent: "#cf2618", font: "abril", background: "cream", bg: "#ece2cf", text: "#181613", demoFont: "'Arial Narrow', sans-serif" },
  { id: "bauhaus", name: "Bauhaus", hint: "Geometría con rojo", theme: "bauhaus", accent: "#be1e2d", font: "lora", background: "cream", bg: "#f2e9d8", text: "#1f1d1a", demoFont: "'Century Gothic', sans-serif" },
  { id: "mincho", name: "Japón mincho", hint: "Papel claro y sello rojo, calma", theme: "mincho", accent: "#b3342c", font: "lora", background: "cream", bg: "#f5f3ed", text: "#26241f", demoFont: "'MS Mincho', serif" },
  { id: "brutal", name: "Brutalista", hint: "Crudo y directo", theme: "brutal", accent: "#ff4d00", font: "lora", background: "cream", bg: "#efefea", text: "#000000", demoFont: "'Consolas', monospace" },
  { id: "docu", name: "Docu rojo", hint: "Documental de denuncia", theme: "docu", accent: "#e3120b", font: "lora", background: "cream", bg: "#f9f7f1", text: "#121212", demoFont: "'Franklin Gothic Medium', sans-serif" },
  { id: "art_deco", name: "Art Déco", hint: "Lujo 1920, crema y dorado", theme: "art_deco", accent: "#bd9a4e", font: "playfair", background: "cream", bg: "#f3ead6", text: "#16130d", demoFont: "'Cinzel', serif" },
  { id: "blueprint", name: "Blueprint", hint: "Plano de ingeniería, azul y cian", theme: "blueprint", accent: "#34c6d8", font: "dmserif", background: "ink", bg: "#0b2138", text: "#dbe9f4", demoFont: "'Consolas', monospace" },
  { id: "noir", name: "Noir", hint: "Cine negro, blanco y negro", theme: "noir", accent: "#d8d2c4", font: "playfair", background: "dark", bg: "#0a0a0a", text: "#f2f2f0", demoFont: "'Playfair Display', serif" },
] as const;

export type EditorialTheme = (typeof EDITORIAL_THEMES)[number];

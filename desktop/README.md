# `desktop/` — la aplicación de escritorio de Viralito

Un envoltorio [Tauri](https://tauri.app) que arranca el dashboard de Next.js y lo
muestra en una ventana propia, con Python y ffmpeg empaquetados al lado. La idea
es que quien lo instale no tenga que saber que hay un servidor local corriendo.

> Este archivo era la plantilla que genera `create-tauri-app` — "This template
> should help get you started developing with Tauri in vanilla HTML, CSS and
> JavaScript" y un enlace a extensiones de VS Code. Cero información del
> proyecto: ni cómo se compila, ni qué produce, ni por qué el build local no
> funciona en esta máquina.

## Qué produce

| Artefacto | Qué es |
|---|---|
| `src-tauri/target/release/Viralito.exe` | el ejecutable pelado |
| `dist/EstrategiaViralStudio-Setup.exe` | instalador NSIS (~2 MB) que baja el resto |
| ZIP portable | todo junto, sin instalar |

La versión se declara en **tres** archivos y tienen que coincidir:
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` y `package.json`. Hoy: `0.5.0`.
(`package.json` decía `0.1.0`, desalineado de los otros dos.)

## Estado: ya está compilado, y espera tu clic

El instalador de **v0.5.0 ya se compiló** en GitHub Actions y salió bien
(corrida del 24 ago 2026, artifact `instalador-windows`, 651 MB).

No aparece publicado porque el workflow crea el release como **borrador**
(`draft: true` en `release.yml`). Eso es a propósito: publicar algo que la gente
va a descargar es una decisión de persona, no de un pipeline.

Para terminarlo:

1. Entrá a **Releases** en el repositorio → verás `v0.5.0` marcado como *Draft*.
2. Revisá los archivos adjuntos y las notas que generó solas.
3. **Publish release**.

O bajate el artifact directamente desde la corrida, sin publicar nada:
Actions → release → la corrida en verde → `instalador-windows`.

## Cómo se compila

**El camino real es CI**, no la máquina de desarrollo. `.github/workflows/release.yml`
lo hace entero en un runner de Windows:

```powershell
# opción A — sin publicar nada: deja el instalador como artifact descargable
gh workflow run release.yml

# opción B — publica un Release de GitHub (necesita elegir el número de versión)
git tag v0.5.0 && git push origin v0.5.0
```

Ojo con la B: los tags del repo hoy son `v3.0`, `v3.1-publish-ready`, `v3.2-preciosa`,
mientras la app se versiona `0.5.0`. Son dos numeraciones distintas conviviendo;
elegí a conciencia cuál seguís antes de publicar.

## Por qué no compila en esta máquina

**Smart App Control de Windows está en modo bloqueo** (`VerifiedAndReputablePolicyState = 1`).
Bloquea binarios sin firma por reputación, y los *build scripts* que Cargo compila
y ejecuta al vuelo son exactamente eso. El build muere así:

```
error: failed to run custom build command for `getrandom v0.4.2`
  could not execute process ...\build-script-build (never executed)
  Una directiva de Control de aplicaciones bloqueó este archivo. (os error 4551)
```

Es el mismo mecanismo que ya había bloqueado `pandas/_libs/testing.pyd` y dejó 13
transcripciones vacías sin un solo error. Apagarlo es **irreversible** (ADR-001 en
`memoria/decisiones/`): una vez apagado, Windows no deja volver a encenderlo sin
reinstalar. Por eso no se apaga, y por eso el instalador se compila en CI.

## `build-installer.ps1`

Compila sólo el instalador NSIS, suponiendo que el ejecutable ya está.

```powershell
.\build-installer.ps1                                   # rutas por omisión
.\build-installer.ps1 -OutDir D:\salida -ToolsDir D:\tools
```

Dos cosas que estaban mal y ya no:

- Escribía por omisión en `C:\hermes-data\`, que es de otro proyecto y **en esta
  máquina no existe**. Dejaba el `.exe` en una carpeta recién creada que nadie
  mira, sin fallar. Ahora resuelve `VIRAL_DATA_ROOT` primero, `viral-data`
  después y `hermes-data` sólo como legado — igual que `paths.ts` y `config.py`.
- Si la descarga de NSIS venía corta decía *"Reintenta"*. Desde el 28 ago 2026
  SourceForge responde **403 en todas sus rutas** (`master.dl`, `downloads`,
  `prdownloads`, `sourceforge.net/projects/.../download` — probadas una por una),
  y reintentar un 403 no lo arregla nunca. Ahora el error dice qué pasó y ofrece
  las tres salidas reales.

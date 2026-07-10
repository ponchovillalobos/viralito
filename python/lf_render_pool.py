"""POOL de render-servers para LARGOS (OLA 3 — VELOCIDAD).
─────────────────────────────────────────────────────────────────────────────
PROBLEMA: long_form_pipeline.py renderiza ~15 clips en paralelo (ThreadPoolExecutor)
pero CADA render invoca el CLI de Remotion, que RE-BUNDLEA webpack (15-40s) por clip.
15 clips → 15 bundles redundantes.

SOLUCIÓN: un POOL de N procesos `remotion/render-server.mjs` de larga vida. Cada
proceso bundlea UNA vez al arrancar y luego atiende renders por stdin (JSON-lines,
protocolo ya existente). Con N procesos hay N renders concurrentes SIN re-bundlear.
El bundle se paga una sola vez por proceso, en paralelo, al warmup.

DISEÑO (conservador):
  • POOL de N instancias (NO una instancia con N renders concurrentes). El
    render-server YA serializa un render por proceso (toma un lock interno), así
    que N procesos = N renders en paralelo, reusando el mecanismo probado. Cada
    proceso arma su PROPIO bundle (no compartimos el dir del bundle entre procesos:
    `bundle()` devuelve un temp dir distinto por proceso y compartirlo sería frágil).
  • GUARD DE RAM (no negociable): cada instancia consume browser + offthread cache.
    Bajamos el offthread cache POR-INSTANCIA cuando hay pool y calculamos cuántas
    instancias caben en la RAM LIBRE. Si no caben ≥2, o la RAM total es baja, NO
    se usa pool → el caller cae al camino CLI-directo de siempre.
  • PARALELISMO: el ThreadPoolExecutor de STEP 7 NO cambia. Cada worker-thread
    toma un server del pool (cola thread-safe), lo usa para UN render, y lo
    devuelve. workers efectivos = tamaño del pool = N.
  • FALLBACK: si el pool no arranca, un server no queda listo, o el guard dice que
    no → render_clip_via_pool() devuelve None y el caller usa el CLI directo. Si un
    render puntual falla en el server, ese clip cae al CLI directo (per-clip).

APAGABLE: VIRAL_LF_RENDER_POOL=0 fuerza el camino CLI-directo (diagnóstico).

El .mp4 que produce el server es IDÉNTICO al de `npx remotion render` (mismos
props, mismo codec h264, mismo offthread cache, timeout, preset x264/crf del
hw_profile). El post-fx (LUT), audio mastering y post-encode NVENC los sigue
aplicando el caller sobre ese .mp4 — este módulo NO los toca.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PYTHON_DIR.parent
REMOTION_DIR = PROJECT_ROOT / "remotion"
RENDER_SERVER_MJS = REMOTION_DIR / "render-server.mjs"

# Tope de arranque del bundle inicial por proceso (paridad con el cliente TS: 90s).
_READY_TIMEOUT_S = float(os.environ.get("VIRAL_LF_POOL_READY_TIMEOUT", "120"))
# Tope DURO de un render por el server. Si se excede, ese render falla y el clip
# cae al CLI directo (per-clip). Generoso: un clip largo bajo carga puede tardar.
_RENDER_HARD_TIMEOUT_S = float(os.environ.get("VIRAL_LF_POOL_RENDER_TIMEOUT", str(25 * 60)))


def pool_enabled() -> bool:
    """¿Está habilitado el pool? Default sí; VIRAL_LF_RENDER_POOL=0 lo apaga."""
    return os.environ.get("VIRAL_LF_RENDER_POOL", "1") != "0"


def _log(msg: str) -> None:
    print(f"[lf-pool] {msg}", file=sys.stderr, flush=True)


def _node_bin() -> str | None:
    """Ejecutable de node (mismo criterio que long_form_pipeline._node_bin)."""
    import shutil  # noqa: PLC0415

    override = os.environ.get("VIRAL_NODE_BIN")
    if override and Path(override).exists():
        return override
    embedded = REMOTION_DIR / "node_modules" / ".bin" / (
        "node.exe" if sys.platform == "win32" else "node"
    )
    if embedded.exists():
        return str(embedded)
    return shutil.which("node")


# ── GUARD DE RAM ─────────────────────────────────────────────────────────────
def _ram_total_and_free_gb() -> tuple[float, float]:
    """(ram_total_gb, ram_free_gb). psutil si está; si no, total de hw_profile y
    asumimos ~60% libre (conservador: subestima lo libre para NO sobre-asignar)."""
    try:
        import psutil  # noqa: PLC0415

        vm = psutil.virtual_memory()
        return (vm.total / 1024**3, vm.available / 1024**3)
    except Exception:  # noqa: BLE001
        try:
            from hw_profile import detect  # noqa: PLC0415

            total = float(detect().get("ram_gb", 8.0))
        except Exception:  # noqa: BLE001
            total = 8.0
        return (total, total * 0.6)


# Costo de RAM estimado por instancia de render-server (browser + node + overhead),
# SIN contar el offthread cache (ese se suma aparte porque lo bajamos por-instancia).
# Conservador: ~2.5 GB cubre Chromium headless + el proceso Node de Remotion.
_PER_INSTANCE_BASE_GB = float(os.environ.get("VIRAL_LF_POOL_INSTANCE_GB", "2.5"))
# RAM total mínima para siquiera intentar el pool. Bajo esto → CLI directo.
_MIN_RAM_GB = float(os.environ.get("VIRAL_LF_POOL_MIN_RAM_GB", "12"))
# Reserva fija para el SO + resto de la app (no la tocamos al repartir).
_RAM_RESERVE_GB = float(os.environ.get("VIRAL_LF_POOL_RESERVE_GB", "3"))


def _per_instance_offthread_bytes(n_instances: int) -> int:
    """Offthread cache POR-INSTANCIA cuando hay pool.

    El camino single usa ~35% de la RAM para UNA instancia. Con N instancias eso
    es DEMASIADO (35%×N excede la RAM). Repartimos un presupuesto total del 15% de
    la RAM entre las N instancias. Tope 2 GB / piso 256 MB por instancia.
    """
    total_gb, _free = _ram_total_and_free_gb()
    total_bytes = int(total_gb * 1024**3)
    budget = int(total_bytes * 0.15)
    per = budget // max(1, n_instances)
    return max(256 * 1024**2, min(per, 2 * 1024**3))


def plan_pool_size(requested_workers: int) -> int:
    """N efectivo de instancias del pool según el GUARD DE RAM.

    FÓRMULA:
      ram_total, ram_free = memoria (GB)
      si ram_total < MIN_RAM_GB (12)  → 0  (no pool)
      usable      = ram_free - RESERVE_GB (3)
      costo_inst  = PER_INSTANCE_BASE_GB (2.5) + offthread_por_instancia(requested)/1e9
      cabe        = floor(usable / costo_inst)
      N           = min(requested_workers, cabe)
      si N < 2    → 0  (no vale la pena el pool; CLI directo)

    Devuelve N (≥2) o 0 si el guard dice que NO se use pool.
    """
    if requested_workers < 2:
        return 0
    total_gb, free_gb = _ram_total_and_free_gb()
    if total_gb < _MIN_RAM_GB:
        _log(f"RAM total {total_gb:.1f}GB < {_MIN_RAM_GB:.0f}GB mínimo → sin pool (CLI directo)")
        return 0
    usable = free_gb - _RAM_RESERVE_GB
    if usable <= 0:
        _log(f"RAM libre {free_gb:.1f}GB ≤ reserva {_RAM_RESERVE_GB:.0f}GB → sin pool")
        return 0
    # offthread por-instancia se calcula con el N solicitado (estimación inicial).
    off_gb = _per_instance_offthread_bytes(requested_workers) / 1024**3
    cost = _PER_INSTANCE_BASE_GB + off_gb
    fits = int(usable // cost)
    n = min(requested_workers, max(0, fits))
    if n < 2:
        _log(
            f"caben {fits} instancia(s) en {usable:.1f}GB usable (costo ~{cost:.1f}GB c/u) "
            f"→ <2, sin pool (CLI directo)"
        )
        return 0
    _log(
        f"pool de {n} render-server(s): RAM total {total_gb:.1f}GB / libre {free_gb:.1f}GB, "
        f"offthread ~{off_gb:.2f}GB c/u"
    )
    return n


# ── Una instancia del render-server (proceso + lector de stdout) ─────────────
class _ServerInstance:
    """Un proceso render-server.mjs. Sincrónico: un render a la vez (igual que el
    server, que serializa). El pool da paralelismo teniendo N instancias."""

    def __init__(self, idx: int, node: str, offthread_bytes: int):
        self.idx = idx
        self.node = node
        self.offthread_bytes = offthread_bytes
        self.proc: subprocess.Popen | None = None
        self._ready = threading.Event()
        self._ready_ok = False
        self._lock = threading.Lock()
        # Resultado del render en curso (lo llena el lector de stdout).
        self._result: dict | None = None
        self._result_evt = threading.Event()
        self._reader: threading.Thread | None = None
        self._next_id = 0
        # Throttle del progreso re-emitido a stderr (frame y timestamp del último print).
        self._prog_frame = -10_000
        self._prog_ts = 0.0
        # Última vez que ESTA instancia imprimió algo a stderr (progreso o log del srv).
        # El heartbeat de render() solo habla si esto envejece.
        self._last_out_ts = time.time()

    def start(self) -> bool:
        """Arranca el proceso y espera el `ready` (bundle armado). False si falla."""
        env = dict(os.environ)
        env.setdefault("PYTHONIOENCODING", "utf-8")
        env.setdefault("PYTHONUTF8", "1")
        try:
            self.proc = subprocess.Popen(
                [self.node, str(RENDER_SERVER_MJS)],
                cwd=str(REMOTION_DIR),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                bufsize=1,
            )
        except (OSError, ValueError) as e:
            _log(f"instancia {self.idx}: no arrancó ({e})")
            return False
        self._reader = threading.Thread(
            target=self._read_stdout, daemon=True, name=f"lf-pool-{self.idx}"
        )
        self._reader.start()
        threading.Thread(
            target=self._drain_stderr, daemon=True, name=f"lf-pool-err-{self.idx}"
        ).start()
        if not self._ready.wait(timeout=_READY_TIMEOUT_S):
            _log(f"instancia {self.idx}: no quedó lista en {_READY_TIMEOUT_S:.0f}s")
            self.stop()
            return False
        return self._ready_ok

    def _drain_stderr(self) -> None:
        proc = self.proc
        if not proc or not proc.stderr:
            return
        try:
            for line in proc.stderr:
                line = line.rstrip()
                if line:
                    self._last_out_ts = time.time()
                    _log(f"srv{self.idx}: {line}")
        except (ValueError, OSError):
            pass

    def _read_stdout(self) -> None:
        proc = self.proc
        if not proc or not proc.stdout:
            return
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = msg.get("type")
                if t == "ready":
                    self._ready_ok = True
                    self._ready.set()
                elif t == "fatal":
                    _log(f"instancia {self.idx}: fatal al bundlear ({msg.get('error')})")
                    self._ready_ok = False
                    self._ready.set()
                elif t == "result":
                    self._result = msg
                    self._result_evt.set()
                elif t == "progress":
                    # CRÍTICO: re-emitir el progreso a stderr. El caller (ruta del job)
                    # resetea su idle-timeout de 20 min con CADA línea; si el pool se
                    # queda mudo durante un render largo, el job entero se mata como
                    # "colgado" aunque el render iba bien (causa del bug "dejó de
                    # responder por 20 minutos"). Formato "Rendered X/Y" = el mismo del
                    # CLI, que processLine ya parsea para la barra. Throttle: cada 30
                    # frames o 15s, y siempre el frame final.
                    cur = int(msg.get("renderedFrames") or 0)
                    tot = int(msg.get("totalFrames") or 0)
                    now = time.time()
                    if tot > 0 and (
                        cur - self._prog_frame >= 30
                        or now - self._prog_ts >= 15
                        or cur >= tot
                    ):
                        self._prog_frame = cur
                        self._prog_ts = now
                        self._last_out_ts = now
                        _log(f"srv{self.idx}: Rendered {cur}/{tot}")
                # pong → se ignora (no rompe el render)
        except (ValueError, OSError):
            pass
        # stdout cerrado: el proceso murió. Desbloquear cualquier espera.
        self._ready.set()
        self._result_evt.set()

    def render(self, props_path: Path, out_path: Path, concurrency: int, timeout_ms: int) -> bool:
        """Envía UN render y espera el result. True si ok. Bloqueante (un render a
        la vez por instancia)."""
        with self._lock:
            proc = self.proc
            if not proc or proc.poll() is not None or not proc.stdin:
                return False
            self._next_id += 1
            req_id = f"{self.idx}-{self._next_id}"
            self._result = None
            self._result_evt.clear()
            self._prog_frame = -10_000
            self._prog_ts = 0.0
            req = {
                "id": req_id,
                "propsPath": str(props_path),
                "outPath": str(out_path),
                "concurrency": concurrency,
                "timeoutMs": timeout_ms,
                "scale": 1,
                "offthreadCacheBytes": self.offthread_bytes,
            }
            try:
                proc.stdin.write(json.dumps(req) + "\n")
                proc.stdin.flush()
            except (OSError, ValueError) as e:
                _log(f"instancia {self.idx}: no pude escribir el pedido ({e})")
                return False
            # Espera en rebanadas de 60s con HEARTBEAT: si la instancia lleva >55s sin
            # imprimir nada (ni progreso ni logs), avisamos que sigue viva para que el
            # idle-timeout del job no la dé por muerta. Un cuelgue REAL lo corta el
            # tope duro de _RENDER_HARD_TIMEOUT_S y ese clip cae al CLI directo.
            t_wait0 = time.time()
            got_result = False
            while time.time() - t_wait0 < _RENDER_HARD_TIMEOUT_S:
                if self._result_evt.wait(timeout=60):
                    got_result = True
                    break
                if time.time() - self._last_out_ts > 55:
                    self._last_out_ts = time.time()
                    mins = (time.time() - t_wait0) / 60
                    _log(
                        f"instancia {self.idx}: render en curso, sin progreso nuevo "
                        f"({mins:.0f} min)…"
                    )
            if not got_result:
                _log(f"instancia {self.idx}: render timeout ({_RENDER_HARD_TIMEOUT_S:.0f}s)")
                # Render colgado: matar la instancia (el caller cae a CLI directo).
                self.stop()
                return False
            res = self._result
            if not res or not res.get("ok"):
                err = (res or {}).get("error", "sin resultado")
                _log(f"instancia {self.idx}: render falló ({str(err)[:200]})")
                return False
            return True

    def alive(self) -> bool:
        return bool(self.proc and self.proc.poll() is None)

    def stop(self) -> None:
        proc = self.proc
        if not proc:
            return
        try:
            if proc.stdin:
                try:
                    proc.stdin.write("shutdown\n")
                    proc.stdin.flush()
                except (OSError, ValueError):
                    pass
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        except Exception:  # noqa: BLE001
            pass
        finally:
            self.proc = None


# ── El pool ──────────────────────────────────────────────────────────────────
class RenderPool:
    """Pool de N _ServerInstance. Thread-safe: render_clip() toma una instancia
    libre (cola), la usa para un render, y la devuelve. Apto para llamarse desde
    los worker-threads del ThreadPoolExecutor de STEP 7."""

    def __init__(self, instances: list[_ServerInstance]):
        self._instances = instances
        self._free: queue.Queue[_ServerInstance] = queue.Queue()
        # Instancias VIVAS restantes. Cuando llega a 0, render_clip devuelve False
        # al instante (todo cae al CLI directo) en vez de esperar una instancia que
        # jamás va a volver a la cola.
        self._alive_count = len(instances)
        self._count_lock = threading.Lock()
        for inst in instances:
            self._free.put(inst)

    @property
    def size(self) -> int:
        return len(self._instances)

    def render_clip(
        self, props_path: Path, out_path: Path, concurrency: int, timeout_ms: int
    ) -> bool:
        """Renderiza un clip usando una instancia libre del pool. True si ok; False
        si la instancia murió/falló (el caller cae al CLI directo para ESE clip).
        Una instancia muerta NO se reencola (se retira del pool).

        DEADLOCK FIX (2026-07-06): el get() era BLOQUEANTE SIN TIMEOUT. Si todas las
        instancias morían en la primera ola, la cola quedaba vacía para siempre y los
        workers de la ola siguiente se colgaban aquí — el job entero moría a los 20 min
        por "dejó de responder" sin emitir una sola línea. Ahora: si no quedan vivas
        → False inmediato; si no hay libre en 10s → False (ese clip va por CLI)."""
        with self._count_lock:
            if self._alive_count <= 0:
                return False
        try:
            inst = self._free.get(timeout=10)
        except queue.Empty:
            _log("sin instancia libre en 10s → este clip va por CLI directo")
            return False
        try:
            if not inst.alive():
                return False
            ok = inst.render(props_path, out_path, concurrency, timeout_ms)
            return ok
        finally:
            # Solo reencolar si sigue viva (un render fallido pudo matarla).
            if inst.alive():
                self._free.put(inst)
            else:
                with self._count_lock:
                    self._alive_count -= 1
                    left = self._alive_count
                _log(f"instancia {inst.idx} retirada del pool (muerta); quedan {left} viva(s)")

    def shutdown(self) -> None:
        for inst in self._instances:
            inst.stop()


def start_pool(requested_workers: int) -> RenderPool | None:
    """Arranca el pool si el guard de RAM lo permite y al menos 2 instancias
    quedan listas. Devuelve el RenderPool o None (→ caller usa CLI directo).

    El bundle se arma en paralelo en las N instancias (cada `start()` espera su
    propio ready). Si <2 quedan listas, se descarta el pool (no vale la pena)."""
    if not pool_enabled():
        _log("deshabilitado por VIRAL_LF_RENDER_POOL=0 → CLI directo")
        return None
    if not RENDER_SERVER_MJS.exists():
        _log(f"no existe {RENDER_SERVER_MJS.name} → CLI directo")
        return None
    node = _node_bin()
    if not node:
        _log("no encontré node → CLI directo")
        return None
    n = plan_pool_size(requested_workers)
    if n < 2:
        return None  # plan_pool_size ya logueó el motivo

    offthread = _per_instance_offthread_bytes(n)
    instances = [_ServerInstance(i, node, offthread) for i in range(n)]

    # Arranque en paralelo: cada instancia bundlea de una; esperamos a todas.
    threads = []
    results: dict[int, bool] = {}
    lock = threading.Lock()

    def _boot(inst: _ServerInstance) -> None:
        ok = inst.start()
        with lock:
            results[inst.idx] = ok

    t0 = time.time()
    for inst in instances:
        t = threading.Thread(target=_boot, args=(inst,), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()

    ready = [inst for inst in instances if results.get(inst.idx)]
    dead = [inst for inst in instances if not results.get(inst.idx)]
    for inst in dead:
        inst.stop()

    if len(ready) < 2:
        _log(f"solo {len(ready)} instancia(s) lista(s) → descarto el pool (CLI directo)")
        for inst in ready:
            inst.stop()
        return None
    _log(
        f"pool listo: {len(ready)}/{n} instancia(s) en {time.time() - t0:.1f}s "
        f"(bundle una vez por proceso)"
    )
    return RenderPool(ready)

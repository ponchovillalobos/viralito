import os
import subprocess
import sys
import pathlib

PY = sys.executable
ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_transcribe_help_no_emite_warning_de_torchcodec(tmp_path):
    res = subprocess.run(
        [PY, str(ROOT / "transcribe.py"), "--help"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "VIRAL_DATA_ROOT": str(tmp_path)},
    )
    assert "torchcodec is not installed" not in res.stderr, res.stderr[-500:]

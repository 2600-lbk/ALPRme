#!/usr/bin/env python3
"""Copy ONNX models and OCR config from the fast-alpr/fast-plate-ocr cache into
public/models/ for the web app and JS tests.

The Python fast-alpr library downloads models to ~/.cache/ on first use. This
script copies them to public/models/ with the filenames expected by the
TypeScript app.

Run via uv:
    uv run python scripts/setup-models.py

Or with system Python 3.10+ and PyYAML installed:
    python3 scripts/setup-models.py
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML not available. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

CACHE_ROOT = Path.home() / ".cache"

# (cache_subpath, target_filename) — copy from cache to public/models/
MODEL_COPIES: list[tuple[str, str]] = [
    ("open-image-models/yolo-v9-t-256-license-plate-end2end/yolo-v9-t-256-license-plates-end2end.onnx",
     "yolo-v9-t-256.onnx"),
    ("open-image-models/yolo-v9-t-384-license-plate-end2end/yolo-v9-t-384-license-plates-end2end.onnx",
     "yolo-v9-t-384.onnx"),
    ("open-image-models/yolo-v9-t-512-license-plate-end2end/yolo-v9-t-512-license-plates-end2end.onnx",
     "yolo-v9-t-512.onnx"),
    ("fast-plate-ocr/cct-xs-v2-global-model/cct_xs_v2_global.onnx",
     "cct_xs_v2_global.onnx"),
    ("fast-plate-ocr/cct-s-v2-global-model/cct_s_v2_global.onnx",
     "cct_s_v2_global.onnx"),
]

# Both OCR models use the same config in practice (identical YAML).
# Convert to JSON and write once.
OCR_YAML_CONFIG = ("fast-plate-ocr/cct-xs-v2-global-model/"
                   "cct_xs_v2_global_plate_config.yaml")
OCR_JSON_CONFIG = "cct_v2_global_plate_config.json"


def setup() -> None:
    root = Path(__file__).resolve().parents[1]
    models_dir = root / "public" / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    # --- Copy ONNX models ---
    copied = 0
    for cache_subpath, target_name in MODEL_COPIES:
        src = CACHE_ROOT / cache_subpath
        dst = models_dir / target_name

        if not src.exists():
            print(f"  SKIP {target_name}: not found at {src}")
            print(f"    Run the Python fixtures first to populate the cache:")
            print(f"    uv run python test/fixtures/build_fixtures.py")
            continue

        if dst.exists() and dst.stat().st_size == src.stat().st_size:
            print(f"  OK   {target_name} (already present)")
            copied += 1
            continue

        shutil.copy2(src, dst)
        print(f"  COPY {target_name} ({src.stat().st_size / 1e6:.1f} MB)")
        copied += 1

    # --- Convert YAML config to JSON ---
    yaml_src = CACHE_ROOT / OCR_YAML_CONFIG
    json_dst = models_dir / OCR_JSON_CONFIG

    if not yaml_src.exists():
        print(f"  SKIP {OCR_JSON_CONFIG}: YAML config not found at {yaml_src}")
        print(f"    Run the Python fixtures first to populate the cache.")
    else:
        with open(yaml_src) as f:
            config = yaml.safe_load(f)
        with open(json_dst, "w") as f:
            json.dump(config, f, indent=2)
        print(f"  COPY {OCR_JSON_CONFIG} (YAML -> JSON)")

    print()
    total = len(MODEL_COPIES)
    print(f"Models: {copied}/{total} copied to {models_dir}")
    print(f"Config: {OCR_JSON_CONFIG} written to {models_dir}")

    if copied < total:
        print()
        print("Some models are missing from the cache. To populate the cache:")
        print("  1. Clone the reference repos into reference_repos/")
        print("  2. Run: uv sync")
        print("  3. Run: uv run python test/fixtures/build_fixtures.py")


if __name__ == "__main__":
    setup()

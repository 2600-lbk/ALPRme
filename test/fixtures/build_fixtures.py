#!/usr/bin/env python3
"""Build ALPR test fixtures using the reference Python fast-alpr library.

Run via uv:
    uv run python test/fixtures/build_fixtures.py

This script:
1. Downloads the detector and OCR ONNX models (cached to ~/.cache/)
2. Runs the reference ALPR pipeline on each fixture image
3. Writes expected.json containing plate text, bounding boxes, and confidences
"""

from __future__ import annotations

import json
import os
import ssl
import sys
from pathlib import Path

import certifi
import cv2
import numpy as np

os.environ["SSL_CERT_FILE"] = certifi.where()

import urllib.request
ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=certifi.where())


def to_json(obj):
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def main():
    root = Path(__file__).resolve().parents[2]
    fixtures_dir = root / "test" / "fixtures" / "alpr"

    # Also look for images in a dataset subdirectory (from HuggingFace pulls)
    dataset_dir = fixtures_dir / "dataset"
    image_paths: list[Path] = []
    for d in [fixtures_dir, dataset_dir]:
        if d.exists():
            image_paths.extend(sorted(d.glob("*.png")))
            image_paths.extend(sorted(d.glob("*.jpg")))
            image_paths.extend(sorted(d.glob("*.jpeg")))

    if not image_paths:
        print("No fixture images found in test/fixtures/alpr/ or test/fixtures/alpr/dataset/", file=sys.stderr)
        sys.exit(1)

    # Load ground-truth plate_text from the dataset metadata (if available).
    ground_truth: dict[str, str] = {}
    meta_path = dataset_dir / "metadata.json"
    if meta_path.exists():
        with open(meta_path) as f:
            ground_truth = json.load(f)
        print(f"Loaded {len(ground_truth)} ground-truth plate texts from metadata.json")

    try:
        from fast_alpr import ALPR
    except ImportError:
        print("fast-alpr not installed. Run: uv sync", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(image_paths)} fixture image(s)")
    print("Initializing ALPR (first run downloads models to ~/.cache/)...")

    alpr = ALPR(
        detector_model="yolo-v9-t-384-license-plate-end2end",
        detector_conf_thresh=0.4,
        ocr_model="cct-xs-v2-global-model",
    )

    for img_path in image_paths:
        print(f"\nProcessing: {img_path.name}")
        frame = cv2.imread(str(img_path))
        if frame is None:
            print(f"  SKIP: could not read image", file=sys.stderr)
            continue

        results = alpr.predict(frame)

        expected = {
            "image": img_path.name,
            "width": int(frame.shape[1]),
            "height": int(frame.shape[0]),
            "detections": [],
        }

        gt = ground_truth.get(img_path.name)
        if gt:
            expected["ground_truth"] = gt

        for r in results:
            detection = r.detection
            ocr = r.ocr
            bbox = detection.bounding_box

            conf_val = 0.0
            char_confs: list[float] = []
            if ocr is not None:
                raw_conf = ocr.confidence
                if isinstance(raw_conf, (list, np.ndarray)):
                    char_confs = [float(c) for c in raw_conf]
                    conf_val = float(np.mean(char_confs)) if char_confs else 0.0
                else:
                    conf_val = float(raw_conf) if raw_conf is not None else 0.0

            entry = {
                "plate": ocr.text if ocr else "",
                "confidence": conf_val,
                "char_confidences": char_confs,
                "bbox": {
                    "x1": int(bbox.x1),
                    "y1": int(bbox.y1),
                    "x2": int(bbox.x2),
                    "y2": int(bbox.y2),
                },
                "detector_confidence": float(detection.confidence),
                "region": ocr.region if ocr else None,
                "region_confidence": ocr.region_confidence if ocr else None,
            }
            expected["detections"].append(entry)
            plate_str = entry["plate"] if entry["plate"] else "(no plate)"
            print(f"  -> {plate_str} @ ({entry['bbox']['x1']},{entry['bbox']['y1']},{entry['bbox']['x2']},{entry['bbox']['y2']})")

        out_path = fixtures_dir / f"{img_path.stem}.expected.json"
        with open(out_path, "w") as f:
            json.dump(expected, f, indent=2, default=to_json)
        print(f"  wrote {len(expected['detections'])} detection(s) to {out_path.name}")

    print(f"\nDone. Wrote {len(image_paths)} expected.json file(s).")


if __name__ == "__main__":
    main()

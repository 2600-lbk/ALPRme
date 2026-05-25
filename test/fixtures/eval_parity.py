#!/usr/bin/env python3
"""Cross-model parity evaluation for license plate detection & OCR.

Run via uv:
    uv run python test/fixtures/eval_parity.py

Evaluates all 6 model combinations (3 detectors × 2 OCRs) across 4 strategies
(whole-image, 1×1 tile, 2×2 tile, 3×3 tile) on USA plate images from the
HuggingFace dataset. Compares results against dataset ground truth.

Output:
  - Console table (per-image detail + summary)
  - test/fixtures/eval_results.json (full per-detection data for JS tests)
"""

from __future__ import annotations

import json
import os
import re
import ssl
import sys
import time
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import certifi
import cv2
import numpy as np

os.environ["SSL_CERT_FILE"] = certifi.where()
ssl._create_default_https_context = lambda: ssl.create_default_context(  # noqa: E731
    cafile=certifi.where()
)

OCR_ALPHABET_RE = re.compile(r"[^0-9A-Z]")


def normalize_plate(text: str) -> str:
    """Strip characters not in the OCR alphabet (0-9A-Z)."""
    return OCR_ALPHABET_RE.sub("", text.upper())

# ---------------------------------------------------------------------------
# Model matrix
# ---------------------------------------------------------------------------

MODEL_COMBOS: list[dict[str, str | int]] = [
    {"detector": "yolo-v9-t-256-license-plate-end2end", "ocr": "cct-xs-v2-global-model", "size": 256},
    {"detector": "yolo-v9-t-256-license-plate-end2end", "ocr": "cct-s-v2-global-model",  "size": 256},
    {"detector": "yolo-v9-t-384-license-plate-end2end", "ocr": "cct-xs-v2-global-model", "size": 384},
    {"detector": "yolo-v9-t-384-license-plate-end2end", "ocr": "cct-s-v2-global-model",  "size": 384},
    {"detector": "yolo-v9-t-512-license-plate-end2end", "ocr": "cct-xs-v2-global-model", "size": 512},
    {"detector": "yolo-v9-t-512-license-plate-end2end", "ocr": "cct-s-v2-global-model",  "size": 512},
]

STRATEGIES: list[tuple[str, int, int]] = [
    ("whole", 0, 0),   # special: standard ALPR.predict()
    ("1x1",   1, 1),
    ("2x2",   2, 2),
    ("3x3",   3, 3),
]

TILE_OVERLAP = 0.2
NMS_IOU_THRESHOLD = 0.5


# ---------------------------------------------------------------------------
# Lightweight result containers
# ---------------------------------------------------------------------------

@dataclass
class DetectionRecord:
    plate: str
    confidence: float
    char_confidences: list[float]
    detector_confidence: float
    bbox: dict[str, float]
    region: str | None
    region_confidence: float | None

    @classmethod
    def from_alpr(cls, result) -> DetectionRecord:
        det = result.detection
        ocr = result.ocr
        bbox = det.bounding_box
        conf_val: float = 0.0
        char_confs: list[float] = []
        if ocr is not None:
            raw = ocr.confidence
            if isinstance(raw, (list, np.ndarray)):
                char_confs = [float(c) for c in raw]  # type: ignore[arg-type]
                conf_val = float(np.mean(char_confs)) if char_confs else 0.0
            else:
                conf_val = float(raw) if raw is not None else 0.0
        return cls(
            plate=ocr.text if ocr else "",
            confidence=conf_val,
            char_confidences=char_confs,
            detector_confidence=float(det.confidence),
            bbox={"x1": float(bbox.x1), "y1": float(bbox.y1),
                  "x2": float(bbox.x2), "y2": float(bbox.y2)},
            region=ocr.region if ocr else None,
            region_confidence=ocr.region_confidence if ocr else None,
        )


@dataclass
class EvalEntry:
    time_ms: float
    detections: list[DetectionRecord]
    plates: list[str]
    best_edit_distance: int
    exact_match: bool
    detection_count: int
    best_confidence: float


@dataclass
class ImageResult:
    image: str
    ground_truth: str
    width: int
    height: int
    combos: dict[str, dict[str, EvalEntry]] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def edit_distance(a: str, b: str) -> int:
    if len(a) == 0:
        return len(b)
    if len(b) == 0:
        return len(a)
    m: list[list[int]] = [[i] for i in range(len(b) + 1)]
    m[0] = list(range(len(a) + 1))
    for i in range(1, len(b) + 1):
        for j in range(1, len(a) + 1):
            m[i].append(
                m[i - 1][j - 1] if b[i - 1] == a[j - 1]
                else min(m[i - 1][j - 1], m[i][j - 1], m[i - 1][j]) + 1
            )
    return m[len(b)][len(a)]


def iou_bbox(a: dict[str, float], b: dict[str, float]) -> float:
    ix1 = max(a["x1"], b["x1"])
    iy1 = max(a["y1"], b["y1"])
    ix2 = min(a["x2"], b["x2"])
    iy2 = min(a["y2"], b["y2"])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = (a["x2"] - a["x1"]) * (a["y2"] - a["y1"])
    area_b = (b["x2"] - b["x1"]) * (b["y2"] - b["y1"])
    return inter / (area_a + area_b - inter)


def greedy_nms(
    detections: Sequence[Any],
    iou_threshold: float,
) -> list[Any]:
    """Greedy NMS on DetectionResult objects (sorted by confidence)."""
    sorted_dets = sorted(detections, key=lambda d: d.confidence, reverse=True)
    kept: list[Any] = []
    for det in sorted_dets:
        suppressed = False
        for k in kept:
            a = det.bounding_box
            b = k.bounding_box
            if a.iou(b) > iou_threshold:
                suppressed = True
                break
        if not suppressed:
            kept.append(det)
    return kept


# ---------------------------------------------------------------------------
# Tiled prediction
# ---------------------------------------------------------------------------

def run_tiled(
    alpr,  # fast_alpr.ALPR
    frame: np.ndarray,
    cols: int,
    rows: int,
    overlap: float = TILE_OVERLAP,
) -> list[Any]:  # list of ALPRResult
    """Run the detector on tiles of the frame, reproject, cross-tile NMS, then OCR."""
    h, w = frame.shape[:2]
    cell_w = w / cols
    cell_h = h / rows
    pad_x = cell_w * overlap / 2.0
    pad_y = cell_h * overlap / 2.0

    all_dets: list[Any] = []  # DetectionResult with reprojected bboxes

    for r in range(rows):
        for c in range(cols):
            x1 = int(c * cell_w - pad_x)
            y1 = int(r * cell_h - pad_y)
            x2 = int((c + 1) * cell_w + pad_x)
            y2 = int((r + 1) * cell_h + pad_y)
            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(w, x2)
            y2 = min(h, y2)
            if x2 <= x1 or y2 <= y1:
                continue

            tile = frame[y1:y2, x1:x2]
            tile_dets = alpr.detector.predict(tile)

            for det in tile_dets:
                bb = det.bounding_box
                new_bbox = replace(bb, x1=float(x1) + bb.x1, y1=float(y1) + bb.y1,
                                   x2=float(x1) + bb.x2, y2=float(y1) + bb.y2)
                new_det = replace(det, bounding_box=new_bbox)
                all_dets.append(new_det)

    # Cross-tile NMS
    kept_dets = greedy_nms(all_dets, NMS_IOU_THRESHOLD)

    # OCR on kept detections
    results: list[Any] = []
    # Import locally to avoid top-level dependency
    from fast_alpr.alpr import ALPRResult  # type: ignore[import-not-found]
    for det in kept_dets:
        bb = det.bounding_box
        bx1 = max(0, int(bb.x1))
        by1 = max(0, int(bb.y1))
        bx2 = min(w, int(bb.x2))
        by2 = min(h, int(bb.y2))
        if bx2 <= bx1 or by2 <= by1:
            continue
        crop = frame[by1:by2, bx1:bx2]
        ocr_result = alpr.ocr.predict(crop)
        results.append(ALPRResult(detection=det, ocr=ocr_result))
    return results


# ---------------------------------------------------------------------------
# Evaluation helpers
# ---------------------------------------------------------------------------

def evaluate_results(
    alpr_results: list[Any],
    ground_truth: str,
    elapsed_ms: float,
) -> EvalEntry:
    records = [DetectionRecord.from_alpr(r) for r in alpr_results]
    plates = [r.plate for r in records if r.plate]
    # Normalize both sides for comparison — OCR alphabet is 0-9A-Z only
    norm_gt = normalize_plate(ground_truth)
    norm_plates = [normalize_plate(p) for p in plates]

    # Best edit distance to ground truth
    if norm_plates:
        dists = [edit_distance(p, norm_gt) for p in norm_plates]
        best_dist = min(dists)
        best_idx = dists.index(best_dist)
        best_conf = records[best_idx].confidence
        exact = best_dist == 0
    else:
        best_dist = len(norm_gt) if norm_gt else len(ground_truth)
        best_conf = 0.0
        exact = False

    return EvalEntry(
        time_ms=round(elapsed_ms, 1),
        detections=records,
        plates=plates,
        best_edit_distance=best_dist,
        exact_match=exact,
        detection_count=len(alpr_results),
        best_confidence=round(best_conf, 4),
    )


# ---------------------------------------------------------------------------
# Table formatting
# ---------------------------------------------------------------------------

def pad(s: str, w: int) -> str:
    return s.ljust(w)


def combo_label(combo: dict[str, str | int]) -> str:
    det_name = str(combo["detector"]).replace("-license-plate-end2end", "")
    ocr_name = str(combo["ocr"]).replace("-global-model", "")
    return f"{det_name}/{ocr_name}"


def print_summary(results: list[ImageResult]) -> None:
    """Print a summary table of exact match counts and average edit distance."""
    # Aggregate per combo × strategy
    summary: dict[str, dict[str, dict[str, Any]]] = {}
    for combo in MODEL_COMBOS:
        ck = combo_label(combo)
        summary[ck] = {}
        for strat_name, _, _ in STRATEGIES:
            summary[ck][strat_name] = {
                "total": 0, "exact": 0, "sum_edit": 0, "sum_time": 0.0,
                "sum_dets": 0,
            }

    for img_res in results:
        for ck, strats in img_res.combos.items():
            for sn, entry in strats.items():
                agg = summary[ck][sn]
                agg["total"] += 1
                if entry.exact_match:
                    agg["exact"] += 1
                agg["sum_edit"] += entry.best_edit_distance
                agg["sum_time"] += entry.time_ms
                agg["sum_dets"] += entry.detection_count

    # Summary table header
    hdr = (
        f"{pad('Detector', 25)} | {pad('OCR', 17)} | {pad('Strat', 6)} | "
        f"{'Exact Match':>13} | {'Avg Edit':>9} | {'Avg Time':>10} | {'Avg Dets':>9}"
    )
    print()
    print("SUMMARY")
    print("-" * len(hdr))
    print(hdr)
    print("-" * len(hdr))

    for combo in MODEL_COMBOS:
        ck = combo_label(combo)
        det_short = str(combo["detector"]).replace("-license-plate-end2end", "")
        ocr_short = str(combo["ocr"]).replace("-global-model", "")
        for strat_name, _, _ in STRATEGIES:
            agg = summary[ck][strat_name]
            t = agg["total"]
            pct = f"{agg['exact']}/{t} {agg['exact']/t*100:.0f}%" if t > 0 else "N/A"
            avg_edit = f"{agg['sum_edit']/t:.2f}" if t > 0 else "-"
            avg_time = f"{agg['sum_time']/t:.1f}ms" if t > 0 else "-"
            avg_dets = f"{agg['sum_dets']/t:.2f}" if t > 0 else "-"
            print(
                f"{pad(det_short, 25)} | {pad(ocr_short, 17)} | {pad(strat_name, 6)} | "
                f"{pct:>13} | {avg_edit:>9} | {avg_time:>10} | {avg_dets:>9}",
            )

    print("-" * len(hdr))
    print()


def print_detail(results: list[ImageResult], max_rows: int | None = None) -> None:
    """Print per-image detail rows."""
    # Determine column widths
    max_img = max((len(r.image) for r in results), default=10)
    max_gt = max((len(r.ground_truth) for r in results), default=10)

    hdr = (
        f"{pad('Image', max_img + 2)} | {pad('GT', max_gt + 2)} | "
        f"{pad('Detector', 20)} | {pad('OCR', 15)} | "
        f"{pad('Strat', 6)} | {pad('Plates', 25)} | "
        f"{'Edit':>4} | {'Match':>5} | {'Conf':>6} | {'Time':>8}"
    )
    sep = "-" * len(hdr)
    printed = 0

    for img_res in results:
        for combo in MODEL_COMBOS:
            ck = combo_label(combo)
            if ck not in img_res.combos:
                continue
            det_short = str(combo["detector"]).replace("-license-plate-end2end", "")
            ocr_short = str(combo["ocr"]).replace("-global-model", "")
            for strat_name, _, _ in STRATEGIES:
                entry = img_res.combos[ck].get(strat_name)
                if entry is None:
                    continue
                if printed == 0:
                    print()
                    print(hdr)
                    print(sep)

                plates_str = ",".join(entry.plates) if entry.plates else "(none)"
                if len(plates_str) > 25:
                    plates_str = plates_str[:22] + "..."

                print(
                    f"{pad(img_res.image, max_img + 2)} | "
                    f"{pad(img_res.ground_truth, max_gt + 2)} | "
                    f"{pad(det_short, 20)} | {pad(ocr_short, 15)} | "
                    f"{pad(strat_name, 6)} | {pad(plates_str, 25)} | "
                    f"{entry.best_edit_distance:>4} | "
                    f"{'✓' if entry.exact_match else '✗':>5} | "
                    f"{entry.best_confidence:>6.3f} | "
                    f"{entry.time_ms:>7.1f}ms",
                )
                printed += 1
                if max_rows and printed >= max_rows:
                    break
            if max_rows and printed >= max_rows:
                break
        if max_rows and printed >= max_rows:
            print(f"... (showing first {max_rows} rows, {len(results)} images total)")
            break

    if printed > 0:
        print(sep)


# ---------------------------------------------------------------------------
# JSON export
# ---------------------------------------------------------------------------

def to_json(obj: Any) -> Any:
    if isinstance(obj, np.integer):
        return int(obj)  # type: ignore[arg-type]
    if isinstance(obj, np.floating):
        return float(obj)  # type: ignore[arg-type]
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def export_json(results: list[ImageResult], out_path: Path) -> None:
    data: dict[str, Any] = {
        "meta": {
            "dataset": "UniqueData/license_plates",
            "date": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "total_images": len(results),
        },
        "images": {},
    }
    for r in results:
        img_data: dict[str, Any] = {
            "ground_truth": r.ground_truth,
            "width": r.width,
            "height": r.height,
            "results": {},
        }
        for ck, strats in r.combos.items():
            for sn, entry in strats.items():
                key = f"{ck}|{sn}"
                img_data["results"][key] = {
                    "time_ms": entry.time_ms,
                    "detections": [
                        {
                            "plate": d.plate,
                            "confidence": d.confidence,
                            "char_confidences": d.char_confidences,
                            "detector_confidence": d.detector_confidence,
                            "bbox": d.bbox,
                            "region": d.region,
                            "region_confidence": d.region_confidence,
                        }
                        for d in entry.detections
                    ],
                    "plates": entry.plates,
                    "best_edit_distance": entry.best_edit_distance,
                    "exact_match": entry.exact_match,
                    "detection_count": entry.detection_count,
                    "best_confidence": entry.best_confidence,
                }
        data["images"][r.image] = img_data

    with open(out_path, "w") as f:
        json.dump(data, f, indent=2, default=to_json)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    root = Path(__file__).resolve().parents[2]
    fixtures_dir = root / "test" / "fixtures" / "alpr"
    dataset_dir = fixtures_dir / "dataset"

    # Load ground truth
    meta_path = dataset_dir / "metadata.json"
    if not meta_path.exists():
        print(f"metadata.json not found at {meta_path}", file=sys.stderr)
        print("Run 'uv run python test/fixtures/pull_dataset.py' first.", file=sys.stderr)
        sys.exit(1)

    with open(meta_path) as f:
        ground_truth: dict[str, str] = json.load(f)

    # Collect images (both existing fixtures and dataset dir)
    image_paths: list[tuple[Path, str, str]] = []  # (path, filename, gt)
    for d in [fixtures_dir, dataset_dir]:
        if not d.exists():
            continue
        for ext in ("*.jpg", "*.jpeg", "*.png"):
            for p in sorted(d.glob(ext)):
                name = p.name
                gt = ground_truth.get(name)
                if gt:
                    image_paths.append((p, name, gt))

    if not image_paths:
        print("No images with ground truth found.", file=sys.stderr)
        sys.exit(1)

    print(f"Evaluating {len(image_paths)} image(s) × {len(MODEL_COMBOS)} combos × {len(STRATEGIES)} strategies")
    print(f"Total: {len(image_paths) * len(MODEL_COMBOS) * len(STRATEGIES)} evaluations\n")

    try:
        from fast_alpr import ALPR
    except ImportError:
        print("fast-alpr not installed. Run: uv sync", file=sys.stderr)
        sys.exit(1)

    results: list[ImageResult] = []

    for combo_idx, combo in enumerate(MODEL_COMBOS):
        ck = combo_label(combo)
        print(f"[{combo_idx + 1}/{len(MODEL_COMBOS)}] Initializing {ck}...")

        try:
            alpr = ALPR(
                detector_model=str(combo["detector"]),
                detector_conf_thresh=0.4,
                ocr_model=str(combo["ocr"]),
            )
        except Exception as e:
            print(f"  FAILED to init {ck}: {e}", file=sys.stderr)
            continue

        for img_idx, (img_path, name, gt) in enumerate(image_paths):
            frame = cv2.imread(str(img_path))
            if frame is None:
                print(f"  SKIP {name}: could not read image", file=sys.stderr)
                continue

            h, w = frame.shape[:2]

            # Find or create ImageResult
            img_res = next((r for r in results if r.image == name), None)
            if img_res is None:
                img_res = ImageResult(image=name, ground_truth=gt, width=w, height=h)
                results.append(img_res)

            if ck not in img_res.combos:
                img_res.combos[ck] = {}

            for strat_name, cols, rows in STRATEGIES:
                tag = f"{name} / {ck} / {strat_name}"
                try:
                    t0 = time.perf_counter()
                    if strat_name == "whole":
                        alpr_results = alpr.predict(frame)
                    else:
                        alpr_results = run_tiled(alpr, frame, cols, rows)
                    elapsed = (time.perf_counter() - t0) * 1000.0

                    entry = evaluate_results(alpr_results, gt, elapsed)
                    img_res.combos[ck][strat_name] = entry

                    plates_str = ",".join(entry.plates) if entry.plates else "(none)"
                    emoji = "✓" if entry.exact_match else "✗"
                    print(f"  {tag:60s} {emoji} edit={entry.best_edit_distance} "
                          f"plates=[{plates_str}] {entry.time_ms:.0f}ms")
                except Exception as e:
                    print(f"  {tag}: ERROR {e}", file=sys.stderr)
                    img_res.combos[ck][strat_name] = EvalEntry(
                        time_ms=0, detections=[], plates=[],
                        best_edit_distance=len(gt), exact_match=False,
                        detection_count=0, best_confidence=0.0,
                    )

        # Dispose to free memory
        try:
            alpr.dispose()
        except Exception:
            pass

    # Print detail (first 80 rows)
    print_detail(results, max_rows=80)

    # Print summary
    print_summary(results)

    # Export JSON
    json_path = fixtures_dir / "eval_results.json"
    export_json(results, json_path)
    print(f"Full results written to {json_path}")
    print("Done.")


if __name__ == "__main__":
    main()

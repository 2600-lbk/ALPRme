#!/usr/bin/env python3
"""Pull USA license plate images from HuggingFace dataset 'UniqueData/license_plates'.

Run via uv:
    uv run python test/fixtures/pull_dataset.py

Uses the dataset's TSV metadata to filter for country='USA' and extracts
plate_text as ground truth. Plate text is normalized to strip characters
not in the OCR alphabet (0-9A-Z) since the models don't predict separators.

Images and a metadata.json are written to test/fixtures/alpr/dataset/ which
is gitignored — pulled on demand, never checked into the repo.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download
from PIL import Image

OCR_ALPHABET = re.compile(r"[^0-9A-Z]")


def normalize_plate(text: str) -> str:
    """Strip characters not in the OCR alphabet (0-9A-Z)."""
    return OCR_ALPHABET.sub("", text.upper())


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    out_dir = root / "test" / "fixtures" / "alpr" / "dataset"
    out_dir.mkdir(parents=True, exist_ok=True)

    repo = "UniqueData/license_plates"
    tsv_path = "Car License Plate Detection Dataset.tsv"

    print(f"Downloading {tsv_path} from {repo}...")
    try:
        local_tsv = hf_hub_download(
            repo_id=repo, filename=tsv_path, repo_type="dataset",
        )
    except Exception as e:
        print(f"Error downloading TSV: {e}", file=sys.stderr)
        sys.exit(1)

    usa_rows: list[dict[str, str]] = []
    with open(local_tsv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            country = (row.get("country") or "").strip()
            plate_text = (row.get("plate_text") or "").strip()
            filename = (row.get("filename") or "").strip()
            if country.upper() == "USA" and plate_text and filename:
                norm = normalize_plate(plate_text)
                if norm:
                    usa_rows.append({"filename": filename, "plate_text": norm})

    print(f"Found {len(usa_rows)} USA rows with plate_text")
    if not usa_rows:
        print("No USA rows found.", file=sys.stderr)
        sys.exit(1)

    metadata: dict[str, str] = {}
    count = 0
    skipped = 0

    for row in usa_rows:
        filename: str = row["filename"]
        plate_text: str = row["plate_text"]

        safe_name = plate_text.replace(" ", "_").replace("/", "-")
        stem = f"usa_{safe_name}"
        out_path = out_dir / f"{stem}.jpg"

        if out_path.exists():
            for i in range(2, 100):
                alt = out_dir / f"{stem}_{i}.jpg"
                if not alt.exists():
                    stem = f"{stem}_{i}"
                    out_path = alt
                    break
            else:
                print(f"  SKIP {filename}: too many collisions for '{plate_text}'")
                skipped += 1
                continue

        try:
            local_img = hf_hub_download(
                repo_id=repo,
                filename=f"USA/{filename}",
                repo_type="dataset",
            )
            img = Image.open(local_img).convert("RGB")
            img.save(str(out_path), "JPEG", quality=92)
        except Exception as e:
            print(f"  SKIP {filename}: {e}", file=sys.stderr)
            skipped += 1
            continue

        metadata[out_path.name] = plate_text
        print(f"  {out_path.name:40s}  ->  '{plate_text}'  ({img.width}x{img.height})")
        count += 1

    meta_path = out_dir / "metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2, sort_keys=True)

    print()
    print(f"Downloaded {count} image(s) to {out_dir}")
    print(f"Ground-truth metadata written to {meta_path}")
    if skipped:
        print(f"({skipped} row(s) skipped)")


if __name__ == "__main__":
    main()

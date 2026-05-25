# Evaluation

## Dataset

Test images come from the [UniqueData/license_plates](https://huggingface.co/datasets/UniqueData/license_plates)
dataset on HuggingFace. The dataset provides a TSV file
(`Car License Plate Detection Dataset.tsv`) with columns:

| Column | Description |
|--------|-------------|
| `filename` | Image filename within country subdirectory |
| `plate_text` | Ground truth plate text |
| `country` | Country code (e.g., `USA`) |

`pull_dataset.py` downloads the TSV, filters for `country == 'USA'`, and
downloads each matching image from the `USA/` subdirectory. Plate text is
normalized — characters not in the OCR alphabet (0-9A-Z) are stripped since
the models don't predict hyphens, spaces, or other separators.

All downloaded images live in `test/fixtures/alpr/dataset/` which is
gitignored. Images are pulled on demand and not checked into the repository.

## Pulling test images

```bash
uv run python test/fixtures/pull_dataset.py
```

This downloads 25 USA license plate images and writes `metadata.json` with
`{filename: normalized_plate_text}` mappings.

## Adding custom test images

1. Place the image in `test/fixtures/alpr/dataset/`
2. Edit `test/fixtures/alpr/dataset/metadata.json` and add an entry:
   ```json
   "my_custom_plate.jpg": "ABC123"
   ```
   Plate text is normalized automatically during evaluation (spaces and
   hyphens are stripped — the OCR alphabet is 0-9A-Z).
3. Run the evaluation:
   ```bash
   uv run python test/fixtures/eval_parity.py
   ```
4. (Optional) Generate expected.json for single-model parity:
   ```bash
   uv run python test/fixtures/build_fixtures.py
   ```

## Running the evaluation

```bash
uv run python test/fixtures/eval_parity.py
```

This script:
1. Loads all images from `test/fixtures/alpr/dataset/` with ground truth
   from `metadata.json`
2. Runs all 6 model combinations × 4 tiling strategies (whole, 1×1, 2×2, 3×3)
3. Computes edit distance, exact match rate, confidence, and timing
4. Prints a console summary table
5. Writes `eval_results.json` for the JS cross-model parity test

The evaluation takes several minutes to complete (3 detectors × 2 OCRs ×
4 strategies × 25 images = 600 predictions).

## Interpreting results

The OCR alphabet is `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_` — no hyphens,
spaces, or lowercase. Ground truth is normalized to match before comparison.

**Exact match** means the predicted plate exactly equals the normalized
ground truth. **Edit distance** is the Levenshtein distance between them
(e.g., `69680P` vs `6968QP` has edit distance 1 — the `0` and `Q` differ).

The 1×1 tiled strategy should produce identical results to whole-image for
the same model combo — this verifies the tiling pipeline is correct for the
single-tile case.

## JS parity verification

After running the Python evaluation:

```bash
npx vitest run test/alpr/cross-model-parity.test.ts
```

This runs the JS ALPR pipeline on the same images and compares against the
Python results from `eval_results.json`. The console report shows per-image
JS vs Python plate text with edit distances and match status.

# ALPRme

On-device license plate recognition for dash cameras. All inference runs locally.

## Quick start

```bash
npm install
bash scripts/gen-certs.sh     # generate HTTPS certs for mobile (needs Docker)
npm run dev:share             # starts HTTPS dev server on your local network
```

Open the HTTPS URL on your phone. The first launch walks you through camera
permissions and model selection. Model files are checked into the repo under
`public/models/` — no extra download step is needed.

**Prerequisites:** Node.js 18+, npm, Docker (for HTTPS certs).

## Run tests

```bash
npm test                      # vitest (unit + parity)
npm run test:e2e              # playwright (browser-based)
uv run python test/fixtures/eval_parity.py   # Python cross-model evaluation
```

Test images must be pulled before running parity tests:

```bash
uv run python test/fixtures/pull_dataset.py     # download USA test images
uv run python test/fixtures/build_fixtures.py   # generate expected.json fixtures
```

## Documentation

See **[docs/](docs/README.md)** for architecture, pipeline details, settings,
testing, evaluation guides, and model setup.

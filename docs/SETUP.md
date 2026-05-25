# Setup

## Prerequisites

- Node.js 18+ and npm
- Python 3.10+ (for test fixture tooling via `uv`)
- Docker (for generating dev HTTPS certificates)

## Install

```bash
npm install
uv sync
```

Model files are checked into `public/models/` and served by the dev server
automatically. To re-fetch models from the Python reference libraries (e.g.
after a clean clone), see `scripts/setup-models.py`.

## Development server

```bash
npm run dev          # HTTP — camera won't work (browsers require HTTPS)
npm run dev:share    # HTTPS — exposes on your local network for mobile testing
```

The `dev:share` command generates self-signed HTTPS certificates if they
don't exist and exposes the dev server on your local IP. Open the printed
URL on your phone.

## iOS HTTPS setup

Apple requires HTTPS for `getUserMedia` (camera access). Self-signed
certificates need the CA to be trusted on the device:

### 1. Generate certificates

```bash
bash scripts/gen-certs.sh
```

Uses Docker (openssl) — no Homebrew or mkcert needed. Generates:
- `certs/ca-cert.pem` — Certificate Authority (install on phone)
- `certs/server-cert.pem` — TLS server certificate
- `certs/server-key.pem` — TLS private key

Certificates are valid for `localhost`, your current WiFi IP, and
`<hostname>.local`.

### 2. Install CA on iPhone

- AirDrop `certs/ca-cert.pem` to iPhone
- **Settings** → tap the downloaded profile → **Install** (enter passcode)
- **Settings → General → About → Certificate Trust Settings**
- Toggle **ON** for "ALPRme Dev CA"

### 3. Verify

Open `https://<your-mac-ip>:5173` in Safari on iPhone. If you see a
certificate warning, check that the CA is toggled ON in Certificate
Trust Settings.

### Road testing (laptop + iPhone hotspot)

- iPhone: **Settings → Personal Hotspot → ON**
- MacBook: connect to iPhone's WiFi
- Re-run `bash scripts/gen-certs.sh` to regenerate for the new IP
- `npm run dev:share` — open the new network URL on iPhone
- The CA cert on iPhone stays valid (one-time trust); only server certs
  are regenerated

## Model files

Model files are checked into `public/models/` and served by the dev server.
To re-fetch them from the Python reference libraries (e.g. after a clean clone
or when the model versions change):

```bash
# Clone reference repos (gitignored) and sync Python deps
git clone <fast-alpr-repo-url> reference_repos/fast-alpr
git clone <fast-plate-ocr-repo-url> reference_repos/fast-plate-ocr
git clone <open-image-models-repo-url> reference_repos/open-image-models
uv sync

# Download models to ~/.cache/ then copy to public/models/
uv run python test/fixtures/build_fixtures.py
uv run python scripts/setup-models.py
```

The setup script copies ONNX files and converts the OCR config from YAML to
JSON with the filenames expected by the TypeScript app.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "CAM ERR" / `getUserMedia` undefined | Not HTTPS. Check the URL starts with `https://` |
| Safari cert warning | Settings → General → About → Certificate Trust Settings → toggle CA ON |
| "MODEL ERR" | Model download failed. Check `public/models/` exists |
| Page blank / module errors | Build the app first: `npm run build`, then `npm run preview:share` |
| WebGPU not available | Check `navigator.gpu` in browser console; requires secure context (HTTPS) and a supported browser |
| Models re-download every launch | Models are precached during SW install — they should persist. If they don't, check that the SW registered successfully in DevTools → Application → Service Workers |

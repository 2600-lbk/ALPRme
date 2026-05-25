#!/bin/bash
# Generate a self-signed CA + server cert valid for localhost and current WiFi IP.
# Uses Docker (openssl) — no brew/mkcert needed.
# Run: bash scripts/gen-certs.sh

set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"

# Detect current WiFi IP (en0 is the primary WiFi interface on macOS)
IP=$(ipconfig getifaddr en0 2>/dev/null || echo "")
HOSTNAME_NAME=$(scutil --get LocalHostName 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "alprme")

echo "=== ALPRme Dev Cert Generator ==="
echo "Hostname: ${HOSTNAME_NAME}.local"
echo "WiFi IP:  ${IP:-none}"

# Build SAN list
SANS="DNS:localhost"
[ -n "$IP" ] && SANS="$SANS,IP:$IP"
SANS="$SANS,DNS:${HOSTNAME_NAME}.local"

echo "SANs:     $SANS"
echo ""

# Step 1: Generate CA key + cert (skip if already exists)
if [ ! -f "$CERT_DIR/ca-cert.pem" ]; then
  echo "[1/4] Generating CA certificate..."
  docker run --rm \
    -v "$CERT_DIR":/certs \
    alpine/openssl req -x509 -newkey rsa:4096 \
    -keyout /certs/ca-key.pem \
    -out /certs/ca-cert.pem \
    -days 3650 -nodes \
    -subj "/CN=ALPRme Dev CA" 2>/dev/null
  echo "       CA cert: certs/ca-cert.pem"
else
  echo "[1/4] CA certificate already exists, skipping."
fi

# Step 2: Generate server key
echo "[2/4] Generating server key..."
docker run --rm \
  -v "$CERT_DIR":/certs \
  alpine/openssl genrsa -out /certs/server-key.pem 2048

# Step 3: Create OpenSSL config with SANs
cat > "$CERT_DIR/server.cnf" << EOCNF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
CN = ALPRme Dev

[v3_req]
subjectAltName = ${SANS}
EOCNF

# Step 4: Generate CSR and sign with CA
echo "[3/4] Generating server CSR..."
docker run --rm \
  -v "$CERT_DIR":/certs \
  alpine/openssl req -new \
  -key /certs/server-key.pem \
  -out /certs/server.csr \
  -config /certs/server.cnf

echo "[4/4] Signing server cert with CA..."
docker run --rm \
  -v "$CERT_DIR":/certs \
  alpine/openssl x509 -req \
  -in /certs/server.csr \
  -CA /certs/ca-cert.pem \
  -CAkey /certs/ca-key.pem \
  -CAcreateserial \
  -out /certs/server-cert.pem \
  -days 365 \
  -extfile /certs/server.cnf \
  -extensions v3_req

# Cleanup CSR and config
rm "$CERT_DIR/server.csr" "$CERT_DIR/server.cnf"

echo ""
echo "=== Done ==="
echo "Server cert: certs/server-cert.pem"
echo "Server key:  certs/server-key.pem"
echo ""
echo "=== iOS Setup ==="
echo "1. AirDrop certs/ca-cert.pem to your iPhone"
echo "2. On iPhone: Settings → tap the downloaded profile → Install"
echo "3. Settings → General → About → Certificate Trust Settings"
echo "4. Toggle ON for 'ALPRme Dev CA'"
echo ""
echo "Then open: https://${IP:-localhost}:5173 on iPhone Safari"

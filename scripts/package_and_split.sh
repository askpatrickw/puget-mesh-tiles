#!/usr/bin/env bash
set -euo pipefail
SRC_DIR="${1:-tiles}"
OUT_DIR="${2:-RELEASE_ASSETS/tiles}"
NAME="$(basename "${OUT_DIR}")"

mkdir -p "${OUT_DIR}"
# Split into 2GB parts
zip -r -s 2000m "${OUT_DIR}/${NAME}.zip" "${SRC_DIR}"

# Checksums
( cd "${OUT_DIR}" && sha256sum *.zip* > SHA256SUMS )

echo "Packages in ${OUT_DIR}:"
ls -lh "${OUT_DIR}"

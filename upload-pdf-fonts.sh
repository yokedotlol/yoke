#!/bin/bash
# Upload PDF fonts to KV (REFERENCE_DATA binding)
# Run this once before the first PDF generation after deployment
set -e

cd "$(dirname "$0")"
source ~/.wrangler/.env
export CLOUDFLARE_API_TOKEN

FONTS_DIR="worker/src/fonts"
BINDING="REFERENCE_DATA"

echo "Uploading PDF fonts to KV..."
for font in Inter-Regular Inter-Medium Inter-SemiBold Inter-Bold JetBrainsMono-Regular; do
  FILE="$FONTS_DIR/${font}.ttf"
  KEY="pdf-font:${font}"
  if [ -f "$FILE" ]; then
    echo "  Uploading $KEY ($(du -h "$FILE" | cut -f1))"
    cd worker && bun x wrangler kv:key put --binding="$BINDING" "$KEY" --path="../$FILE" && cd ..
  else
    echo "  SKIP: $FILE not found"
  fi
done

echo "Done! Fonts uploaded to KV."

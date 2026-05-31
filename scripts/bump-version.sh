#!/bin/bash
set -e
cd "$(dirname "$0")/.."

# ── Read source of truth ─────────────────────────────────────────────
# Worker + Client version lives in root package.json
VERSION=$(node -p "require('./package.json').version")
echo "🔄 Syncing Worker + Client to v${VERSION}..."

# ── Worker YOKE_VERSION constant ─────────────────────────────────────
sed -i "s/export const YOKE_VERSION = \".*\"/export const YOKE_VERSION = \"${VERSION}\"/" worker/src/helpers.ts
echo "  ✅ worker/src/helpers.ts → YOKE_VERSION = \"${VERSION}\""

# ── Sub-package package.json files ───────────────────────────────────
for pkg in client/package.json worker/package.json og-worker/package.json; do
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('${pkg}', 'utf8'));
    p.version = '${VERSION}';
    fs.writeFileSync('${pkg}', JSON.stringify(p, null, 2) + '\n');
  "
  echo "  ✅ ${pkg} → ${VERSION}"
done

# ── README badge ─────────────────────────────────────────────────────
sed -i "s/version-[0-9.]*-blue/version-${VERSION}-blue/" README.md
echo "  ✅ README.md badge → ${VERSION}"

# ── Extension is independently versioned ─────────────────────────────
# Extension version lives in extension/manifest.json and is NOT synced
# here. Bump it manually when extension/ code changes.

# ── CLI is independently versioned ───────────────────────────────────
# CLI version is injected by GoReleaser from git tag (cli/v*).
# No file edit needed — tag IS the version.

# ── Verify ───────────────────────────────────────────────────────────
echo ""
echo "📋 Verification:"
echo "  package.json:           $(node -p "require('./package.json').version")"
echo "  client/package.json:    $(node -p "require('./client/package.json').version")"
echo "  worker/package.json:    $(node -p "require('./worker/package.json').version")"
echo "  og-worker/package.json: $(node -p "require('./og-worker/package.json').version")"
echo "  YOKE_VERSION:           $(grep 'YOKE_VERSION' worker/src/helpers.ts | head -1)"
echo ""
echo "  (extension: $(node -p "require('./extension/manifest.json').version") — independent, not synced)"
echo "  (cli: version injected by GoReleaser from cli/v* tag)"
echo ""
echo "✅ Worker + Client synced to v${VERSION}"
echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md"
echo "  2. git add -A && git commit -m 'release: worker v${VERSION}'"
echo "  3. git push — CI deploys automatically"
echo ""
echo "To release CLI:"
echo "  git tag cli/v<version> && git push --tags"
echo "  → GoReleaser builds binaries + updates Homebrew tap"

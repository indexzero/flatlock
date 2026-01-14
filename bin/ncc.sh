#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "Building flatlock standalone executable..."

# Step 1: Bundle with ncc
echo "Bundling with @vercel/ncc..."
pnpm exec ncc build bin/flatlock.js -o ncc/dist -m

# Step 2: Create standalone executable
# ncc already includes the shebang, so we just copy and make executable
echo ""
echo "Creating standalone executable..."

cp ncc/dist/index.js ncc/flatlock
chmod +x ncc/flatlock

echo ""
echo "Build complete! Standalone executable created: ncc/flatlock"
echo ""
echo "To test: ./ncc/flatlock --help"

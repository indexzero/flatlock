#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Build flatlock
echo "Building flatlock standalone executable..."
echo "Bundling with @vercel/ncc..."
pnpm exec ncc build bin/flatlock.js -o ncc/dist-flatlock -m

echo "Creating standalone executable..."
cp ncc/dist-flatlock/index.js ncc/flatlock
chmod +x ncc/flatlock

# Build flatcover
echo ""
echo "Building flatcover standalone executable..."
echo "Bundling with @vercel/ncc..."
pnpm exec ncc build bin/flatcover.js -o ncc/dist-flatcover -m

echo "Creating standalone executable..."
cp ncc/dist-flatcover/index.js ncc/flatcover
chmod +x ncc/flatcover

echo ""
echo "Build complete!"
echo "  ncc/flatlock  - ./ncc/flatlock --help"
echo "  ncc/flatcover - ./ncc/flatcover --help"

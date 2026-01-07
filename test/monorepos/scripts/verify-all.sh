#!/bin/bash
# Full test matrix verification
# Each line is independently runnable
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERIFY="$SCRIPT_DIR/verify-workspace.sh"

echo "=== npm Workspaces Monorepos ==="
echo ""

# socketio/socket.io
$VERIFY socketio/socket.io main packages/socket.io npm
$VERIFY socketio/socket.io main packages/engine.io npm
$VERIFY socketio/socket.io main packages/socket.io-client npm

# npm/cli
$VERIFY npm/cli latest workspaces/arborist npm
$VERIFY npm/cli latest workspaces/libnpmexec npm
$VERIFY npm/cli latest workspaces/config npm

# lerna/lerna
$VERIFY lerna/lerna main packages/lerna npm
$VERIFY lerna/lerna main packages/legacy-structure/commands/create npm

# feathersjs/feathers
$VERIFY feathersjs/feathers dove packages/feathers npm
$VERIFY feathersjs/feathers dove packages/express npm
$VERIFY feathersjs/feathers dove packages/socketio npm

echo ""
echo "=== pnpm Monorepos ==="
echo ""

# vuejs/core
$VERIFY vuejs/core main packages/vue pnpm
$VERIFY vuejs/core main packages/reactivity pnpm
$VERIFY vuejs/core main packages/compiler-core pnpm

# vitejs/vite
$VERIFY vitejs/vite main packages/vite pnpm
$VERIFY vitejs/vite main packages/plugin-vue pnpm
$VERIFY vitejs/vite main packages/create-vite pnpm

# pnpm/pnpm
$VERIFY pnpm/pnpm main pnpm pnpm
$VERIFY pnpm/pnpm main pkg-manager/core pnpm
$VERIFY pnpm/pnpm main pkg-manager/resolve-dependencies pnpm

# sveltejs/svelte
$VERIFY sveltejs/svelte main packages/svelte pnpm
$VERIFY sveltejs/svelte main playgrounds/sandbox pnpm

echo ""
echo "=== Yarn Berry Monorepos ==="
echo ""

# babel/babel
$VERIFY babel/babel main packages/babel-core yarn
$VERIFY babel/babel main packages/babel-parser yarn
$VERIFY babel/babel main packages/babel-cli yarn

# facebook/jest
$VERIFY facebook/jest main packages/jest yarn
$VERIFY facebook/jest main packages/jest-cli yarn
$VERIFY facebook/jest main packages/expect yarn

# prettier/prettier
$VERIFY prettier/prettier main src/cli yarn
$VERIFY prettier/prettier main src/language-js yarn

# yarnpkg/berry
$VERIFY yarnpkg/berry master packages/yarnpkg-core yarn
$VERIFY yarnpkg/berry master packages/yarnpkg-cli yarn
$VERIFY yarnpkg/berry master packages/yarnpkg-pnp yarn

echo ""
echo "=== Yarn Classic Monorepos ==="
echo ""

# facebook/react
$VERIFY facebook/react main packages/react yarn
$VERIFY facebook/react main packages/react-dom yarn
$VERIFY facebook/react main packages/scheduler yarn

# webpack/webpack
$VERIFY webpack/webpack main lib yarn

# mui/material-ui
$VERIFY mui/material-ui master packages/mui-material yarn
$VERIFY mui/material-ui master packages/mui-system yarn
$VERIFY mui/material-ui master packages/mui-lab yarn

# TryGhost/Ghost
$VERIFY TryGhost/Ghost main ghost/core yarn
$VERIFY TryGhost/Ghost main ghost/admin yarn
$VERIFY TryGhost/Ghost main ghost/api-framework yarn

echo ""
echo "=== COMPLETE ==="

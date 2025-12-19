/**
 * @fileoverview pnpm lockfile parser - re-exports from modular implementation
 *
 * This file maintains backward compatibility by re-exporting the pnpm parser
 * from its new modular location at ./pnpm/index.js
 *
 * Supported formats:
 * - shrinkwrap.yaml v3/v4 (2016-2019)
 * - pnpm-lock.yaml v5.x (2019-2022)
 * - pnpm-lock.yaml v6.0 (2023)
 * - pnpm-lock.yaml v9.0 (2024+)
 *
 * @module flatlock/parsers/pnpm
 */

export * from './pnpm/index.js';

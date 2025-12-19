/**
 * @fileoverview Internal/advanced pnpm parser exports
 *
 * This module exports version-specific parsing utilities for advanced use cases
 * such as testing, debugging, or when you need fine-grained control over parsing.
 *
 * For normal usage, import from 'flatlock' or 'flatlock/parsers/pnpm' instead.
 *
 * @module flatlock/parsers/pnpm/internal
 */

// Detection utilities
export {
  detectVersion,
  usesAtSeparator,
  usesSnapshotsSplit,
  usesInlineSpecifiers,
  hasLeadingSlash,
} from './detect.js';

// Shrinkwrap v3/v4 (2016-2019)
export {
  parseSpecShrinkwrap,
  hasPeerSuffix,
  extractPeerSuffix,
} from './shrinkwrap.js';

// v5.x (2019-2022)
export {
  parseSpecV5,
  hasPeerSuffixV5,
  extractPeerSuffixV5,
} from './v5.js';

// v6+ (2023+)
export {
  parseSpecV6Plus,
  hasPeerSuffixV6Plus,
  extractPeerSuffixV6Plus,
  parsePeerDependencies,
} from './v6plus.js';

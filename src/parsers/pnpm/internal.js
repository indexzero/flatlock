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
  hasLeadingSlash,
  usesAtSeparator,
  usesInlineSpecifiers,
  usesSnapshotsSplit
} from './detect.js';

// Shrinkwrap v3/v4 (2016-2019)
export {
  extractPeerSuffix,
  hasPeerSuffix,
  parseSpecShrinkwrap
} from './shrinkwrap.js';

// v5.x (2019-2022)
export {
  extractPeerSuffixV5,
  hasPeerSuffixV5,
  parseSpecV5
} from './v5.js';

// v6+ (2023+)
export {
  extractPeerSuffixV6Plus,
  hasPeerSuffixV6Plus,
  parsePeerDependencies,
  parseSpecV6Plus
} from './v6plus.js';

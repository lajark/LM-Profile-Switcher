/**
 * @lmps/domain — pure domain contracts for LM Profile Switcher.
 *
 * This package defines the typed contracts and JSON Schemas consumed by the
 * core service, the optimizer, the profile store and the adapters. It never
 * imports Node, Tauri, the file system, the network or LM Studio: it is pure
 * data + validation (zod) + YAML serialization and runs unchanged in the
 * WebView.
 */
export * from './errors.js';
export * from './version.js';
export * from './iso-date.js';

export * from './profile.js';
export * from './rules.js';
export * from './hook-rules.js';
export * from './virtual-aliases.js';
export * from './hardware.js';
export * from './capability.js';
export * from './estimate.js';
export * from './resource-fit.js';
export * from './benchmark.js';
export * from './resource-usage.js';
export * from './recommendation.js';
export * from './transaction.js';

export * from './serialize.js';
export * from './migrate.js';
export * from './registry.js';

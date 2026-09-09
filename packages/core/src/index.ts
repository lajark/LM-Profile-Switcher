/**
 * @lmps/core — activation transaction state machine, ports and redaction
 * (M1-005, PRD FR-04).
 *
 * Pure module: no Node built-ins, no network, no LM Studio. The state machine
 * consumes injected ports (runtime/lock/estimate/log) and a runner context
 * (clock, cancellable wait, timeout, tx id), so the whole switch behavior is
 * executable in tests and embeddable in the CLI, the future sidecar and the
 * desktop WebView.
 */
export * from './benchmark.js';
export * from './errors.js';
export * from './lock.js';
export * from './ports.js';
export * from './recommendation.js';
export * from './redact.js';
export * from './runner.js';
export * from './session-lock.js';
export * from './snapshot.js';
export * from './transaction.js';
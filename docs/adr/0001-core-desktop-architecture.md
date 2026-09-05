# ADR-0001: TypeScript Core, CLI First, Thin Tauri Desktop

- Status: Accepted
- Date: 2026-07-25

## Context

The product needs advanced LM Studio load configuration, a CLI, a lightweight desktop app, and a single source of business logic. The official TypeScript SDK has a broader load-configuration surface than the CLI and current REST endpoint. Tauri provides a small native desktop shell but its WebView does not directly provide Node.js capabilities.

## Decision

- Implement the business Core in TypeScript.
- Deliver the CLI before the full desktop application.
- Bundle a local Core Service sidecar for Tauri.
- Keep Rust limited to native shell responsibilities.
- Route LM Studio operations through SDK, REST v1, or CLI by capability.
- Never use private LM Studio files.
- Never base the product on a fork or live dependency of a community app.

## Consequences

Positive:

- full use of the official SDK;
- one business implementation for CLI and desktop;
- testable core before UI;
- independent release and maintenance.

Trade-offs:

- sidecar packaging must be validated;
- IPC lifecycle and authentication add complexity;
- desktop package is larger than a pure-Rust implementation.

## Required Spike

Task M0-006 must validate packaging and choose stdio, local socket, or loopback HTTP. If the official SDK cannot be bundled reliably, a new ADR must compare:
1. Rust Core + limited REST/CLI;
2. Python SDK sidecar;
3. Electron instead of Tauri.

No silent architecture switch is allowed.

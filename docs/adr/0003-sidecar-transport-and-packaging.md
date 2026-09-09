# ADR-0003: Sidecar Transport and Packaging

- Status: Accepted
- Date: 2026-09-05
- Supersedes: none (fleshes out ADR-0001's Required Spike)

## Context

ADR-0001 chose a TypeScript Core bundled as a local Core Service sidecar for the Tauri desktop shell, and made task M0-006 a hard prerequisite: it must validate packaging and choose among stdio, named pipe/socket, or loopback HTTP. The choice had to be driven by measured evidence, not assumption, including streaming, cancellation, crash recovery, packaging size, and SDK bundle compatibility. If the official SDK could not be bundled reliably, a new ADR comparing alternative architectures was required — no silent switch.

In September 2026 the Rust toolchain arrived (rustc/cargo 1.98.1, MSVC), so the spike could run on the real machine. A minimal Node sidecar (`apps/core-service`) was built on the real `@lmps` adapter chain (`createNodeLmStudioEnv` → `probeCapabilities` → `resolveAdapters`), with `@lmstudio/sdk` statically imported, and packaged as a Node SEA single executable. A minimal Tauri 2 desktop shell (`apps/desktop/src-tauri`) spawned the SEA sidecar through `tauri-plugin-shell`, exercised each transport over a full matrix, and wrote the measured report to `~/.lmps/spike/m0-006-report.json` (LOCAL-ONLY).

## Decision

- **Transport: stdio JSON-RPC (newline-delimited JSON) for the internal sidecar IPC.** Auth = one random per-session token frame over the process's own stdin/stdout (second check on process-boundary isolation). Streaming = one JSON frame per stdout line. Cancellation = a `cancel` control frame (or stdin close). Crash recovery = the parent observes `CommandEvent::Terminated` and respawns.
- **Packaging: Node SEA single executable** (`lmps-sidecar-<target-triple>.exe`), built from one esbuild-inlined CJS bundle. All non-`node:` modules — including `@lmstudio/sdk` — are inlined at build time, so the SEA runtime `import()` never needs to load external files.
- **Every session uses a fresh random token**, passed to the sidecar as a command-line argument/process env, validated against the sidecar's own copy before any RPC is accepted. A sidecar started without the correct token refuses all traffic.
- **Loopback HTTP remains reserved for M4-001** (external local automation API), not for the shell–sidecar channel. Named pipe is documented as the middle option but not adopted.
- **Crash/restart is part of the transport contract**: the parent treats sidecar death as recoverable and respawns with the same token.

### Measured evidence (Windows 11, RTX 5060 Ti, 2026-09-05, report in `~/.lmps/spike/m0-006-report.json`)

Run per transport: 200-frame stream, cancellation of an in-flight 10 s request, kill + respawn. Round-trip = `ping` RPC; throughput = stream frames/sec.

| Transport | ping (ms) | stream tps | cancel | restart | address |
|---|---|---|---|---|---|
| stdio | 1.52 | 131,726 | true | true | `stdio` |
| named pipe | 1.68 | 136,258 | true | true | `\\.\pipe\lmps-spike-*` |
| loopback HTTP | 6.87 | 69,529 | true | true | `http://127.0.0.1:<port>` |

All three transports proved cancellation and restart on the real machine. stdio is ~4.5× faster than loopback HTTP for point RPCs and ~1.9× faster for streaming, with zero sockets, zero ports, no listen state, and no client-server handshake to manage. pipe performs marginally better than stdio in the stream loop but exists only on Windows, requires explicit client naming, and buys nothing over stdio within a single spawned process. These numbers are the deciding input; no configuration flag or feature in scope depends on the slower transports.

### Packaging evidence

| Stage | Size |
|---|---|
| esbuild single-file CJS bundle (`dist-bundle/sidecar.cjs`) | 936 KB |
| SEA blob | 936 KB |
| SEA `lmps-sidecar-x86_64-pc-windows-msvc.exe` | 89 MB |
| raw `dist + node_modules` (not used; recorded as floor) | above SEA |

The 89 MB SEA body is dominated by the embedded node.exe; the actual application payload stays under 1 MB. The SEA ran the full spike matrix on the real machine (three transports, auth/ping/stream/cancel/restart), which also verifies `@lmstudio/sdk` static-import compatibility inside the SEA: `@lmstudio/sdk` is inlined by esbuild and loaded from the bundle at startup, so a startup-time incompatibility would have failed every run.

## Alternatives

- **Named pipe** — was the fastest stream loop (136k tps) but Windows-only, adds a named client protocol and no security benefit inside one spawned process; rejected for the internal channel.
- **Loopback HTTP** — fastest to introspect/debug and the only transport with a natural external surface, but ~4.5× slower round-trip, requires port discovery, Bearer tokens per request, and listening state; deliberately kept for M4-001.
- **Bundled node.exe + script instead of SEA** — fallback if SEA/postject failed; not needed, recorded as the rollback path.
- **Rust Core + limited REST/CLI / Python SDK sidecar / Electron** (ADR-0001 §Required Spike) — the SDK bundling succeeded, so the alternative-architecture comparison is not triggered.

## Consequences

Positive:

- stdio matches `tauri-plugin-shell`'s own event channel, so the shell loses no capability it would otherwise need a socket for;
- no ports or sockets to manage, so no external bind, firewall rule, or port-collision surface exists (loopback-only requirement trivially holds);
- token stays inside the spawned process boundary; stdout carries no token;
- SEA ships one self-contained binary; Tauri `bundle.externalBin` resolution is verified (`<exe_dir>/lmps-sidecar.exe`).

Trade-offs:

- 89 MB desktop payload (node.exe embedded) — accepted; a stripped sea (e.g. `--use-malloc`, sign-as-guest) may trim it later, tracked but not blocking;
- stdio is text-framed — fine for JSON-RPC, no binary payload in scope;
- pipe/HTTP code paths remain in the sidecar but unused by the shell; transport stays a runtime-env-variable switch, so the choice is reversible by configuration without a new build.

Rollback:

- Transport: set `LMPS_SIDECAR_TRANSPORT=pipe|http` at spawn time (sidecar built for all three; the Tauri spawn args select it). No rebuild needed.
- Packaging: keep the esbuild bundle; swap the SEA step for packaged `node.exe + sidecar.cjs`. If SEA ever blocks a required capability, ADR-0001's alternative-architecture comparison re-triggers — no silent switch.
- Token scheme: the transport handshake and per-session token design lives in the sidecar wire contract; a new scheme is a sidecar-internal change, shell-visible only through the same auth frame shape.

## Documentation and testing hooks

- Wire contract: `apps/core-service/src/protocol.ts` (frame shapes, auth, cancel, stream-final frame); deterministic tests in `tests/core-service/transports.test.ts` (25 tests, in-memory state machine + real loopback HTTP/pipe servers).
- Architecture guards: `tests/core-service/architecture.test.ts` (import limits, no CJK, loopback-only, no `.lmstudio`/`.internal`, pure-module `node:` ban) and `tests/desktop/architecture.test.ts` (presentation boundary).
- Real-machine evidence and remaining items: `docs/tasks/M0-006-completion.md`.
- SECRET handling: `LMPS_LM_TOKEN` is env-only, never logged, never written into the repo; real-machine smoke output is redacted and lives only under `~/.lmps/realm/`.
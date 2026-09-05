# ADR-0002: One-Way Selective Ports, No Live Community-App Dependency

- Status: Accepted
- Date: 2026-07-25

## Context

Several GitHub projects contain useful hardware, tuning, REST, tray, backup, and i18n implementations. Rebuilding every utility is wasteful, but basing the product on one of those repositories would inherit unrelated scope and release coupling.

## Decision

- Community applications are design references by default.
- A selective port is allowed only from a pinned, license-verified commit.
- Imported code is maintained and tested inside this repository.
- No forks as the product mainline, submodules, subtree sync, build clones, runtime downloads, or private upstream services.
- Provenance and notices are mandatory.

## Consequences

The product remains independent but assumes maintenance responsibility for every imported module. Upstream updates are deliberate new import tasks, not automatic sync.

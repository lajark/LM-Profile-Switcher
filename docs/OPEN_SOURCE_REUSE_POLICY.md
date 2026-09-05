# Open-Source Reuse and Independence Policy / 开源代码复用与独立性政策

## 1. Goal / 目标

Reuse good work lawfully without turning LM Profile Switcher into a fork, wrapper, or runtime dependent of another community application.

在合理合法继承优质代码的同时，确保本项目拥有独立仓库、架构、构建、发布、运行和维护能力。

## 2. Meaning of “Independent” / “独立”的定义

The product must:

- build from its own repository after normal package dependencies are installed;
- run without CC Switch, ggrun, LM Client, config wizard, or any other community app;
- own its profile schema, state machine, tests, release artifacts, and migration path;
- not depend on upstream repository availability or release cadence.

项目独立并不等于“零第三方库”。官方 LM Studio SDK 和通用生态库可以是锁版本依赖，但社区应用仓库不得成为活依赖。

## 3. Allowed Reuse Modes / 允许方式

### Design Reference
Study concepts, architecture, and UX without copying implementation.

### Selective Port
Import a small, clearly bounded implementation from a pinned commit, preserve the applicable notices, adapt it locally, and add local tests.

### Clean Reimplementation
Write a new implementation from documented behavior. If the implementation is substantially informed by identifiable upstream code, record the upstream as a design reference.

### Standard Dependency
Use a published general-purpose library or official SDK through a package manager, with lockfile, license scan, and SBOM.

## 4. Forbidden Coupling / 禁止耦合

- product fork as the main repository;
- Git submodule;
- Git subtree as an ongoing sync mechanism;
- source imports from GitHub URLs;
- build-time cloning;
- runtime code or executable downloads;
- calling an upstream app's private database or internal service;
- requiring an upstream binary;
- copying no-license code;
- removing copyright or license notices;
- using AI rewriting to conceal origin.

## 5. Import Procedure / 移植流程

Before code enters the repository:

1. identify exact repository and commit;
2. verify license at that commit;
3. inspect file-level notices and dependencies;
4. decide reuse mode;
5. record the intended local boundary;
6. copy only the minimum files or algorithm;
7. preserve required notices;
8. adapt into project architecture;
9. add tests;
10. update `docs/PROVENANCE.yml`, `THIRD_PARTY_NOTICES.md`, `LICENSES/`, SBOM, and traceability.

Importing and feature modification should be separate commits.

## 6. Initial Candidates / 首批候选

These are evaluation candidates, not incorporated components:

| Project | Candidate value | Default treatment |
|---|---|---|
| farion1231/cc-switch | Web GUI layout/interaction, tray UX, atomic configuration, i18n patterns | design reference only for the current plan; no source copied; selective port requires a pinned commit and file-level review |
| raketenkater/ggrun | safety headroom, bounded tuning, recovery concepts | design reference; selective algorithm port if justified |
| ghaffaria/lmstudio-config-wizard | task wizard and baseline recommendations | design reference; selective port after quality review |
| LM-Client/client-universal | REST integration and parameter UI patterns | design reference; selective port only if superior to a clean implementation |
| lmstudio-ai/configs | legacy format reference | design reference only |

Before any actual import, pin a commit and re-verify its license.

## 7. Provenance Record / 来源记录

Every selective port must include:

- component ID;
- upstream repository;
- commit SHA;
- upstream path;
- local path;
- reuse type;
- license and copyright;
- modifications;
- verification date;
- reviewer;
- related task and tests.

## 8. Release Requirements / 发布要求

A release must include:

- project license;
- all required third-party license texts;
- generated notices;
- SBOM;
- dependency license report;
- provenance validation result;
- visible acknowledgements in the About page.

This policy is an engineering compliance framework and is not legal advice.

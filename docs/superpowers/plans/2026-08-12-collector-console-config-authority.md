# Collector Console config authority — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Setup UI edits (site, token, CF) stick without hand-editing env; Dokploy/compose Environment redeploy still wins when injected env changes.

**Architecture:** Persist authority in `config-authority.json` (setup stamp + process fingerprint). Boot merges by fingerprint; Save stamps Setup and mutates `process.env`; Alloy force-recreates when env-backed fields change.

**Tech Stack:** TypeScript, Express collector-console, Docker Compose

## Global Constraints

- Do not require Dokploy for Pi installs
- Never log full CF/collector secrets
- Keep Alloy pin `grafana/alloy:v1.5.1`

---

### Task 1: Config authority helpers + read/write/boot

**Files:** `sites/templates/site-box/collector-console/src/config.ts`

- [x] Add `config-authority.json` read/write + process fingerprint
- [x] Change `bootstrapPersistentEnv` / `readConfig` / `writeConfig` per spec
- [x] Apply merged keys onto `process.env` after boot and save

### Task 2: Alloy recreate + warnings

**Files:** `src/index.ts`, `src/alloy.ts`, `public/index.html`

- [x] Force recreate Alloy when site/CF/remote_write/host/ping/scrape change
- [x] Soften Dokploy-only warning strings
- [x] Update Setup hints for Pi + Environment

### Task 3: Validate

- [x] `npm run build` in collector-console
- [x] Update `workflow.md`

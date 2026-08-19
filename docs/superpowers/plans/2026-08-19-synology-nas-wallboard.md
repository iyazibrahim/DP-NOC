# Synology NAS wallboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline; user asked to continue).

**Goal:** Synology SNMP health on the existing wallboard widgets (gauge pie, UP/DOWN, line chart, device stack) — same pattern as Fortinet/Cambium.

**Architecture:** `synology_health` SNMP module + `generate-config.sh` extra target + metric presets. Type `nas` becomes `kind: network`. No new WidgetType.

**Tech Stack:** Alloy v1.5.1 snmp.yml, Prometheus presets, React wallboard widgets already in catalog.

## Global Constraints

- Alloy pin `grafana/alloy:v1.5.1`; full `snmp.yml` only; no `config_merge_strategy`
- No new wallboard widget types
- `nas` is SNMP (`kind: network`), not a collector host
- Follow existing preset `deviceTypes` / `vendors` filtering

---

### Task 1: Type `nas` is an SNMP device

**Files:** `backend/noc-api/src/data/deviceTypes.ts`, `backend/noc-api/data/seed-device-types.json`, `backend/noc-api/src/data/sites.ts`, `backend/noc-api/src/routes/sites.ts`

- [x] Seed + fallback `nas` kind = `network`; migrate runtime `device-types.json` if `nas` was `server`
- [x] `inferKindFromType` no longer maps `nas` → server
- [x] `normalizeDevice` / parse body: type `nas` forces `kind: network`

### Task 2: SNMP module + Alloy extra target

**Files:** `sites/templates/site-box/snmp.yml`, `sites/templates/site-box/generate-config.sh`

- [x] Add `synology_health` module (system/disk/raid + CPU + UCD memory)
- [x] `vendor_module`: type nas + synology/syno/empty/generic → `synology_health`

### Task 3: Presets + existing widgets

**Files:** `backend/noc-api/src/services/metrics.ts`, `frontend/wallboard/src/types.ts`, `frontend/wallboard/src/components/DeviceMetricWidgets.tsx`, `frontend/wallboard/src/components/WidgetConfigEditor.tsx`

- [x] Presets `nas_cpu_pct`, `nas_mem_pct`, `nas_vol_free_pct`, `nas_temp_c`, `nas_disk_temp_max_c`, `nas_raid_ok`, `nas_disk_failed`
- [x] Boolean gauge includes `nas_raid_ok`; format unit `C`
- [x] Empty vendor on type nas still shows Synology presets (same as FortiGate)

### Task 4: Inventory UX + docs

**Files:** `frontend/wallboard/src/components/DeviceTypePicker.tsx`, `sites/templates/site-box/collector-console/public/index.html`, `docs/SNMP_VENDOR_HEALTH.md`, `workflow.md`

- [x] Vendor chip `synology`; Collector Console type `nas`
- [x] Document OIDs + Force-apply
- [x] Validate `tsc` wallboard + api

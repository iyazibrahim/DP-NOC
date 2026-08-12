# Collector Console config authority (most recent wins)

**Date:** 2026-08-12  
**Status:** Approved (option C)

## Problem

Setup UI saves `SITE_NAME` / CF secrets to the state `.env`, but `readConfig()` always preferred container `process.env`. Compose defaults `SITE_NAME=site-1`, so choosing site-4 in Setup never stuck. CF secrets entered in Setup also failed to become Alloy container env reliably.

## Decision

**Most recent wins:**

1. **Setup → Save** becomes authority: persist to state (+ data) `.env`, update live `process.env`, stamp `setupSavedAt`, recreate Alloy when metrics/site env keys change.
2. **Environment redeploy** (Dokploy or compose recreate with different injected env) becomes authority: process-env fingerprint change at boot → process overlay wins and is written into `.env`.
3. **Same Environment, console restart:** fingerprint unchanged + prior Setup stamp → persisted Setup `.env` wins (survives Pi restarts without re-typing).

## Authority file

`STATE_DIR/config-authority.json`:

```json
{
  "setupSavedAt": 1710000000000,
  "lastProcessFingerprint": "<stable hash of boot process overlay>"
}
```

## Read / write / boot

- `readConfig`: if Setup is authority → `{...process, ...file}`; else `{...file, ...process}`.
- `writeConfig`: write maps, set `process.env`, set `setupSavedAt=now` (do not refresh fingerprint).
- `bootstrapPersistentEnv`: compute fingerprint of boot overlay; if changed vs last → process wins; else if `setupSavedAt` → file wins; else process wins. Sync winner into `process.env`.

## Alloy

Force recreate (not restart) when site / host / CF / remote_write / ping / scrape change so container env matches Setup.

## UI copy

Hints say Setup or Environment (not Dokploy-only).

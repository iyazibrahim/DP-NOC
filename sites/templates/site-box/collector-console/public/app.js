async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const errMsg =
      (typeof data === "object" && data && (data.message || data.error)) ||
      text ||
      res.statusText;
    throw new Error(String(errMsg));
  }
  return data;
}

function showMsg(el, text, ok) {
  if (!el) return;
  el.className = "msg " + (ok ? "ok" : "bad");
  el.textContent = text;
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtSyncParts(iso) {
  if (!iso) return { date: "—", time: "" };
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    };
  } catch {
    return { date: String(iso), time: "" };
  }
}

function typeLabel(type) {
  const raw = String(type || "").trim();
  const n = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const map = {
    firewall: "Firewall",
    nas: "NAS",
    storage: "NAS",
    switch: "Switch",
    router: "Router",
    accesspoint: "Access point",
    ap: "Access point",
    other: "Other"
  };
  return map[n] || raw || "—";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusPill(state, label) {
  const s = (state || "unknown").toLowerCase();
  let cls = "pill warn";
  let text = label || "Unknown";
  if (s === "healthy" || s === "ok" || s === "up") {
    cls = "pill ok";
    text = label || "Up";
  } else if (s === "critical" || s === "fail" || s === "down") {
    cls = "pill bad";
    text = label || "Down";
  } else if (s === "warning") {
    cls = "pill warn";
    text = label || "Degraded";
  }
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function deviceStatePill(state) {
  const s = (state || "unknown").toLowerCase();
  if (s === "healthy") return statusPill("ok", "Up");
  if (s === "critical") return statusPill("fail", "Down");
  if (s === "warning") return statusPill("warn", "SNMP");
  return statusPill("unknown", "Unknown");
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = false;
  el.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  if (![...document.querySelectorAll(".modal")].some((m) => !m.hidden)) {
    document.body.classList.remove("modal-open");
  }
}

function renderStatus(status) {
  const cards = document.getElementById("status-cards");
  const banner = document.getElementById("status-banner");
  const alloy = status.alloyRunning
    ? '<span class="ok">Running</span>'
    : '<span class="bad">Stopped</span>';
  const dash = status.dashboardConnection || {};
  const dashHtml =
    dash.state === "ok"
      ? `<span class="ok">${escapeHtml(dash.label || "Connected")}</span>`
      : dash.state === "fail"
        ? `<span class="bad">${escapeHtml(dash.label || "Failed")}</span>`
        : `<span class="warn">${escapeHtml(dash.label || "Not configured")}</span>`;
  const sync = status.lastSync;
  const syncLabel = sync
    ? sync.ok
      ? `<span class="ok">${escapeHtml(sync.message)}</span>`
      : `<span class="bad">${escapeHtml(sync.message)}</span>`
    : '<span class="warn">No sync yet</span>';
  const synced = fmtSyncParts(sync?.at);
  const snmpValue = status.configUnsafe
    ? '<span class="bad">Unsafe</span>'
    : status.snmpConfigStale
      ? '<span class="bad">Stale</span>'
      : status.snmpBlockPresent === false && (status.deviceCount ?? 0) > 0
        ? '<span class="bad">Missing</span>'
        : '<span class="ok">Applied</span>';

  cards.innerHTML = `
    <div class="card"><div class="label">Site</div><div class="value">${escapeHtml(status.siteName || "—")}</div></div>
    <div class="card"><div class="label">Alloy</div><div class="value">${alloy}</div></div>
    <div class="card"><div class="label">Dashboard</div><div class="value">${dashHtml}</div></div>
    <div class="card"><div class="label">Devices</div><div class="value">${status.deviceCount ?? 0}</div></div>
    <div class="card"><div class="label">SNMP config</div><div class="value">${snmpValue}</div></div>
    <div class="card"><div class="label">Metrics push</div><div class="value">${
      status.metricsConfigured === false
        ? '<span class="bad">Not set</span>'
        : status.metricsConfigured === true
          ? '<span class="ok">Ready</span>'
          : "—"
    }</div></div>
    <div class="card card--clickable" id="card-snmp-polling" role="button" tabindex="0" title="Click for details">
      <div class="label">SNMP polling</div>
      <div class="value">${
        status.snmpPollingLabel === "Active"
          ? '<span class="ok">Active</span>'
          : '<span class="warn">Idle</span>'
      }</div>
    </div>
    <div class="card"><div class="label">Last sync</div><div class="value stack"><span>${escapeHtml(synced.date)}</span>${
      synced.time ? `<span class="muted">${escapeHtml(synced.time)}</span>` : ""
    }</div></div>
  `;

  const warnings = status.warnings && status.warnings.length
    ? status.warnings
    : status.warning
      ? [status.warning]
      : [];
  if (banner) {
    banner.innerHTML =
      `<div class="banner"><span class="label">Sync status</span>${syncLabel}</div>` +
      warnings
        .map(
          (w) =>
            `<div class="banner"><span class="label">Warning</span><span class="warn">${escapeHtml(w)}</span></div>`
        )
        .join("");
  }

  const snmpCard = document.getElementById("card-snmp-polling");
  if (snmpCard) {
    const open = () => openSnmpModal(status);
    snmpCard.onclick = open;
    snmpCard.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    };
  }
}

function openSnmpModal(status) {
  const body = document.getElementById("snmp-modal-body");
  body.innerHTML = `
    <p><strong>Status:</strong> ${escapeHtml(status.snmpPollingLabel || "—")}</p>
    <p><strong>Devices:</strong> ${status.deviceCount ?? 0}</p>
    <p><strong>SNMP config:</strong> ${
      status.snmpConfigStale ? "Needs Force apply" : status.snmpBlockPresent === false ? "Missing" : "Applied"
    }</p>
    <p><strong>Metrics push:</strong> ${
      status.metricsConfigured === true ? "Ready" : status.metricsConfigured === false ? "Not set" : "—"
    }</p>
    <p class="hint" style="margin-top:12px">
      Device Up means SNMP polling succeeded (not ping). Wi‑Fi client lists are collected by a LAN walk on this collector and sent to the dashboard.
    </p>
    ${
      status.snmpStaleReason?.detail
        ? `<p class="warn" style="margin-top:10px">${escapeHtml(status.snmpStaleReason.detail)}</p>`
        : ""
    }
  `;
  document.getElementById("snmp-modal-msg").textContent = "";
  document.getElementById("snmp-modal-msg").className = "msg";
  openModal("modal-snmp");
}

let cachedDevices = [];
let statusById = {};

async function loadDeviceStatus() {
  try {
    const res = await api("/api/device-status");
    const rows = Array.isArray(res.devices) ? res.devices : [];
    statusById = {};
    for (const row of rows) {
      if (row.deviceId) statusById[row.deviceId] = row;
    }
    return res;
  } catch {
    statusById = {};
    return null;
  }
}

let devicePage = 1;
const DEVICE_PAGE_SIZE = 20;

function renderDevicesTable() {
  const body = document.getElementById("devices-body");
  const pager = document.getElementById("devices-pager");
  if (!Array.isArray(cachedDevices) || cachedDevices.length === 0) {
    body.innerHTML =
      '<tr class="empty-row"><td colspan="6">No devices yet. Add one here, or sync to pull devices already on the NOC.</td></tr>';
    if (pager) pager.hidden = true;
    return;
  }
  const total = cachedDevices.length;
  const totalPages = Math.max(1, Math.ceil(total / DEVICE_PAGE_SIZE));
  if (devicePage > totalPages) devicePage = totalPages;
  if (devicePage < 1) devicePage = 1;
  const start = (devicePage - 1) * DEVICE_PAGE_SIZE;
  const slice = cachedDevices.slice(start, start + DEVICE_PAGE_SIZE);
  body.innerHTML = slice
    .map((d) => {
      const st = statusById[d.id];
      const pill = deviceStatePill(st?.state);
      const notes = st?.notes
        ? `<div class="hint" title="${escapeHtml(st.notes)}">${escapeHtml(st.notes)}</div>`
        : "";
      const community = d.snmpCommunity
        ? escapeHtml(d.snmpCommunity)
        : '<span class="muted">default</span>';
      return `<tr>
        <td class="col-name"><div class="dev-name" title="${escapeHtml(d.name || "")}">${escapeHtml(d.name || "")}</div><div class="dev-id" title="${escapeHtml(d.id || "")}">${escapeHtml(d.id || "")}</div></td>
        <td class="col-status">${pill}${notes}</td>
        <td class="col-ip">${escapeHtml(d.snmpIp || "")}</td>
        <td class="col-community">${community}</td>
        <td class="col-type">${escapeHtml(typeLabel(d.type))}</td>
        <td class="col-actions"><button type="button" class="secondary btn-sm" data-edit="${escapeHtml(d.id || "")}">Edit</button></td>
      </tr>`;
    })
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const d = cachedDevices.find((x) => x.id === id);
      if (d) openDeviceModal(d);
    });
  });

  if (!pager) return;
  pager.hidden = false;
  pager.innerHTML = `<span>Showing ${start + 1}–${start + slice.length} of ${total}</span>
    <span class="pager-btns">
      <button type="button" class="secondary btn-sm" data-page="prev" ${devicePage <= 1 ? "disabled" : ""}>Previous</button>
      <button type="button" class="secondary btn-sm" data-page="next" ${devicePage >= totalPages ? "disabled" : ""}>Next</button>
    </span>`;
  pager.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = btn.getAttribute("data-page");
      devicePage += dir === "next" ? 1 : -1;
      renderDevicesTable();
    });
  });
}

async function loadDevices() {
  cachedDevices = await api("/api/devices");
  await loadDeviceStatus();
  renderDevicesTable();
}

function openDeviceModal(device) {
  const form = document.getElementById("device-form");
  const title = document.getElementById("device-modal-title");
  const msg = document.getElementById("device-form-msg");
  const typeSel = document.getElementById("dev-type");
  msg.textContent = "";
  msg.className = "msg";
  form.reset();

  const editing = Boolean(device?.id);
  title.textContent = editing ? "Edit device" : "Add device";
  document.getElementById("dev-id-hidden").value = editing ? device.id : "";
  document.getElementById("dev-name").value = device?.name || "";
  document.getElementById("dev-snmpIp").value = device?.snmpIp || "";
  // Keep stored type as-is (access-point vs ap) — do not rewrite on edit.
  ensureTypeOption(typeSel, device?.type);
  typeSel.value = resolveTypeValue(device?.type) || "switch";
  document.getElementById("dev-vendor").value = device?.vendor || "generic";
  document.getElementById("dev-snmpCommunity").value = device?.snmpCommunity || "";
  document.getElementById("dev-id").value = "";
  document.getElementById("dev-id-row").style.display = editing ? "none" : "block";
  document.getElementById("device-submit").textContent = editing ? "Save changes" : "Add device";
  openModal("modal-device");
}

/** Prefer access-point for new APs; preserve ap / access-point when editing. */
function resolveTypeValue(t) {
  const raw = String(t || "").trim();
  if (!raw) return "switch";
  const n = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (n === "ap" || n === "accesspoint" || n === "wifi" || n === "wireless") {
    // Preserve exact stored value when it matches a known option
    if (raw === "ap" || raw === "access-point") return raw;
    return "access-point";
  }
  if (n === "storage") return "nas";
  return raw;
}

function ensureTypeOption(sel, type) {
  const v = String(type || "").trim();
  if (!v) return;
  if ([...sel.options].some((o) => o.value === v)) return;
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = v;
  sel.appendChild(opt);
}

async function refreshDashboard() {
  const status = await api("/api/status");
  renderStatus(status);
  await loadDevices();
  if (status.configured) {
    hideWizard();
  } else if (!wizardDismissed) {
    showWizard();
  }
}

async function runRefresh(btn) {
  const msg = document.getElementById("sync-msg");
  if (btn) btn.disabled = true;
  showMsg(msg, "Checking devices…", true);
  try {
    const result = await api("/api/probe-now", { method: "POST", body: "{}" });
    await refreshDashboard();
    showMsg(msg, result.message || "Updated", result.ok !== false);
  } catch (e) {
    showMsg(msg, e.message || "Could not check devices. Try again in a moment.", false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

let siteCatalog = [];

async function loadCatalog() {
  siteCatalog = await api("/api/catalog");
  const options = siteCatalog
    .map(
      (s) =>
        `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`
    )
    .join("");
  document.getElementById("siteName").innerHTML = options;
  const wiz = document.getElementById("wiz-site");
  wiz.innerHTML = options + '<option value="__custom__">Other site id…</option>';
}

let savedConfig = null;

async function loadConfigForm() {
  const cfg = await api("/api/config");
  savedConfig = cfg;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  };
  set("siteName", cfg.siteName);
  set("nocApiUrl", cfg.nocApiUrl);
  set("centralRemoteWriteUrl", cfg.centralRemoteWriteUrl);
  set("cfAccessClientId", cfg.cfAccessClientId);
  set("pingTarget1", cfg.pingTarget1);
  set("pingTarget2", cfg.pingTarget2);
  set("snmpCommunity", cfg.snmpCommunity);
  set("syncIntervalSec", cfg.syncIntervalSec);
  set("hostDeviceId", cfg.hostDeviceId);
  if (cfg.collectorToken) {
    document.getElementById("collectorToken").placeholder =
      cfg.collectorToken + " (saved — enter new to replace)";
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

document.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", () => {
    const which = el.getAttribute("data-close");
    if (which === "device") closeModal("modal-device");
    if (which === "diag") closeModal("modal-diag");
    if (which === "snmp") closeModal("modal-snmp");
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeModal("modal-device");
  closeModal("modal-diag");
  closeModal("modal-snmp");
});

const scanBtn = document.getElementById("btn-scan-clients");
if (scanBtn) {
  scanBtn.addEventListener("click", async () => {
    const msg = document.getElementById("snmp-modal-msg");
    scanBtn.disabled = true;
    try {
      const result = await api("/api/scan-clients", { method: "POST", body: "{}" });
      showMsg(msg, result.message || "Client scan complete", result.ok !== false);
    } catch (e) {
      showMsg(msg, e.message, false);
    } finally {
      scanBtn.disabled = false;
    }
  });
}

const dashToolbar = document.querySelector("#panel-dashboard .toolbar");
if (dashToolbar) {
  dashToolbar.addEventListener("click", (ev) => {
    const origin = ev.target instanceof Element ? ev.target : null;
    const btn = origin?.closest("#btn-refresh");
    if (!btn || !dashToolbar.contains(btn)) return;
    void runRefresh(btn);
  });
}
document.getElementById("btn-add-device").addEventListener("click", () => openDeviceModal(null));

document.getElementById("btn-sync").addEventListener("click", async () => {
  const msg = document.getElementById("sync-msg");
  const btn = document.getElementById("btn-sync");
  btn.disabled = true;
  try {
    const result = await api("/api/sync", { method: "POST", body: JSON.stringify({}) });
    showMsg(msg, result.message || "Sync complete", result.ok);
    await refreshDashboard();
  } catch (e) {
    showMsg(msg, e.message, false);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-force-sync").addEventListener("click", async () => {
  const msg = document.getElementById("sync-msg");
  const btn = document.getElementById("btn-force-sync");
  btn.disabled = true;
  try {
    const result = await api("/api/sync", {
      method: "POST",
      body: JSON.stringify({ force: true })
    });
    showMsg(msg, result.message || "Force apply complete", result.ok);
    await refreshDashboard();
  } catch (e) {
    showMsg(msg, e.message, false);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-diag").addEventListener("click", async () => {
  const out = document.getElementById("diag-out");
  out.textContent = "Loading…";
  openModal("modal-diag");
  try {
    const diag = await api("/api/diagnostics");
    out.textContent = JSON.stringify(diag, null, 2);
  } catch (e) {
    out.textContent = e.message;
  }
});

document.getElementById("dev-type").addEventListener("change", (e) => {
  const type = e.target.value;
  const vendor = document.getElementById("dev-vendor");
  if (type === "nas" && (!vendor.value || vendor.value === "generic")) {
    vendor.value = "synology";
  }
  if (
    (type === "ap" || type === "access-point") &&
    (!vendor.value || vendor.value === "generic")
  ) {
    vendor.value = "cambium";
  }
});

document.getElementById("device-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("device-form-msg");
  const form = e.target;
  const btn = document.getElementById("device-submit");
  const fd = new FormData(form);
  const existingId = String(fd.get("id") || "").trim();
  const body = {
    name: String(fd.get("name") || "").trim(),
    snmpIp: String(fd.get("snmpIp") || "").trim(),
    type: String(fd.get("type") || "switch").trim(),
    vendor: String(fd.get("vendor") || "generic").trim(),
    id: existingId || String(fd.get("newId") || "").trim() || undefined,
    snmpCommunity: String(fd.get("snmpCommunity") || "").trim() || undefined
  };
  btn.disabled = true;
  try {
    const result = await api("/api/devices", { method: "POST", body: JSON.stringify(body) });
    showMsg(msg, result.message || (existingId ? "Device updated" : "Device added"), result.ok !== false);
    closeModal("modal-device");
    await refreshDashboard();
  } catch (err) {
    showMsg(msg, err.message, false);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("setup-msg");
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    const result = await api("/api/config", { method: "POST", body: JSON.stringify(body) });
    showMsg(msg, result.sync?.message || "Saved", true);
    await refreshDashboard();
    document.querySelector('[data-tab="dashboard"]').click();
  } catch (err) {
    showMsg(msg, err.message, false);
  }
});

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  const msg = document.getElementById("settings-msg");
  const body = {
    syncIntervalSec: document.getElementById("syncIntervalSec").value,
    hostDeviceId: document.getElementById("hostDeviceId").value
  };
  try {
    await api("/api/config", { method: "POST", body: JSON.stringify(body) });
    showMsg(msg, "Settings saved", true);
  } catch (err) {
    showMsg(msg, err.message, false);
  }
});

document.getElementById("btn-view-alloy").addEventListener("click", async () => {
  const out = document.getElementById("settings-output");
  out.hidden = false;
  out.textContent = await fetch("/api/config/alloy").then((r) => r.text());
});

document.getElementById("btn-view-logs").addEventListener("click", async () => {
  const out = document.getElementById("settings-output");
  out.hidden = false;
  out.textContent = await fetch("/api/logs/alloy").then((r) => r.text());
});

const WIZARD_LAST = 4;
let wizardStep = 0;
let wizardDismissed = false;
let wizardPrefillDone = false;
let probeOkFor = "";
let allowSkipProbe = false;

function hideWizard() {
  const wiz = document.getElementById("wizard");
  wiz.hidden = true;
  document.getElementById("console").hidden = false;
}

function showWizard() {
  const wiz = document.getElementById("wizard");
  const already = !wiz.hidden;
  if (!wizardPrefillDone) {
    prefillWizard();
    wizardPrefillDone = true;
  }
  wiz.hidden = false;
  document.getElementById("console").hidden = true;
  if (!already) goWizardStep(wizardStep);
}

function wizardSiteId() {
  const sel = document.getElementById("wiz-site").value;
  if (sel === "__custom__") return document.getElementById("wiz-site-custom").value.trim();
  return sel.trim();
}

function prefillWizard() {
  const cfg = savedConfig || {};
  const formSite = document.getElementById("siteName").value;
  const siteName = formSite || cfg.siteName || "";
  const known = siteCatalog.some((s) => s.id === siteName);
  const siteSel = document.getElementById("wiz-site");
  if (siteName && known) {
    siteSel.value = siteName;
  } else if (siteName) {
    siteSel.value = "__custom__";
    document.getElementById("wiz-site-custom").value = siteName;
  }
  document.getElementById("wiz-site-custom-row").hidden = siteSel.value !== "__custom__";
  const take = (formId, cfgVal, fallback) => {
    const typed = document.getElementById(formId)?.value?.trim();
    return typed || cfgVal || fallback || "";
  };
  document.getElementById("wiz-noc").value = take("nocApiUrl", cfg.nocApiUrl);
  document.getElementById("wiz-rw").value = take("centralRemoteWriteUrl", cfg.centralRemoteWriteUrl);
  document.getElementById("wiz-cf-id").value = take("cfAccessClientId", cfg.cfAccessClientId);
  document.getElementById("wiz-ping1").value = take("pingTarget1", cfg.pingTarget1, "1.1.1.1");
  document.getElementById("wiz-ping2").value = take("pingTarget2", cfg.pingTarget2, "139.99.88.174");
  document.getElementById("wiz-community").value = take("snmpCommunity", cfg.snmpCommunity, "public");
  const typedToken = document.getElementById("collectorToken").value.trim();
  if (typedToken) document.getElementById("wiz-token").value = typedToken;
  const tokenHint = document.getElementById("wiz-token-hint");
  if (cfg.collectorToken) {
    document.getElementById("wiz-token").placeholder = "Saved — enter a new token to replace";
    tokenHint.textContent = "A token is already saved. Leave this blank to keep it.";
  }
  if (cfg.cfAccessClientSecret) {
    document.getElementById("wiz-cf-secret").placeholder = "Saved — enter a new secret to replace";
  }
}

function copyWizardToSetupForm() {
  const site = wizardSiteId();
  if (site) {
    const sel = document.getElementById("siteName");
    if (![...sel.options].some((o) => o.value === site)) {
      const opt = document.createElement("option");
      opt.value = site;
      opt.textContent = site;
      sel.appendChild(opt);
    }
    sel.value = site;
  }
  const copy = (from, to) => {
    const value = document.getElementById(from).value.trim();
    if (value) document.getElementById(to).value = value;
  };
  copy("wiz-noc", "nocApiUrl");
  copy("wiz-token", "collectorToken");
  copy("wiz-rw", "centralRemoteWriteUrl");
  copy("wiz-cf-id", "cfAccessClientId");
  copy("wiz-cf-secret", "cfAccessClientSecret");
  copy("wiz-ping1", "pingTarget1");
  copy("wiz-ping2", "pingTarget2");
  copy("wiz-community", "snmpCommunity");
}

function goWizardStep(n) {
  wizardStep = Math.max(0, Math.min(WIZARD_LAST, n));
  document.querySelectorAll(".wizard-stage").forEach((el) => {
    el.hidden = Number(el.dataset.step) !== wizardStep;
  });
  document.querySelectorAll("#wizard-steps li").forEach((li) => {
    const step = Number(li.dataset.stepDot);
    li.classList.toggle("is-current", step === wizardStep);
    li.classList.toggle("is-done", step < wizardStep);
  });
  const titles = [
    "Set up this collector",
    "Connect to the NOC",
    "Send metrics",
    "Local checks",
    "Review and start"
  ];
  document.getElementById("wizard-title").textContent = titles[wizardStep];
  const next = document.getElementById("wizard-next");
  const back = document.getElementById("wizard-back");
  back.hidden = wizardStep === 0;
  next.textContent = wizardStep === WIZARD_LAST ? "Save and start" : wizardStep === 1 ? "Test and continue" : "Continue";
  if (wizardStep === WIZARD_LAST) renderWizardReview();
  showMsg(document.getElementById("wizard-msg"), "", true);
  document.getElementById("wizard-msg").textContent = "";
  document.getElementById("wizard-msg").className = "";
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function renderWizardReview() {
  const site = wizardSiteId();
  const token = document.getElementById("wiz-token").value.trim();
  const cfId = document.getElementById("wiz-cf-id").value.trim();
  const cfSecret = document.getElementById("wiz-cf-secret").value.trim();
  const hostField = document.getElementById("hostDeviceId").value.trim();
  const rows = [
    ["Site", site || "—"],
    ["NOC API", document.getElementById("wiz-noc").value.trim() || "—"],
    ["Token", token ? "Will be saved" : savedConfig?.collectorToken ? "Keep saved token" : "Missing"],
    ["Metrics URL", document.getElementById("wiz-rw").value.trim() || "—"],
    ["Cloudflare Access", cfId || cfSecret ? "Will be saved" : savedConfig?.cfAccessClientId ? "Keep saved credentials" : "Not used"],
    ["Ping targets", `${document.getElementById("wiz-ping1").value.trim()} and ${document.getElementById("wiz-ping2").value.trim()}`],
    ["SNMP community", document.getElementById("wiz-community").value.trim() || "—"],
    ["Host id", hostField || (site ? `${site}-nuc` : "—")]
  ];
  document.getElementById("wizard-review").innerHTML = rows
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
    .join("");
}

function wizardError(text) {
  showMsg(document.getElementById("wizard-msg"), text, false);
}

async function wizardNext() {
  const btn = document.getElementById("wizard-next");
  if (wizardStep === 0) {
    goWizardStep(1);
    return;
  }
  if (wizardStep === 1) {
    const site = wizardSiteId();
    const noc = document.getElementById("wiz-noc").value.trim();
    const token = document.getElementById("wiz-token").value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(site)) {
      wizardError("Enter a site id such as site-1.");
      return;
    }
    if (!isHttpUrl(noc)) {
      wizardError("NOC API URL must start with https:// or http://.");
      return;
    }
    if (!token && !savedConfig?.collectorToken) {
      wizardError("Paste the collector token from the site page.");
      return;
    }
    if (allowSkipProbe) {
      allowSkipProbe = false;
      goWizardStep(2);
      return;
    }
    const key = `${site}|${noc}|${token}`;
    if (probeOkFor === key) {
      goWizardStep(2);
      return;
    }
    btn.disabled = true;
    try {
      const result = await api("/api/setup/probe", {
        method: "POST",
        body: JSON.stringify({ siteName: site, nocApiUrl: noc, collectorToken: token })
      });
      if (!result.ok) {
        allowSkipProbe = true;
        btn.textContent = "Continue anyway";
        wizardError(
          (result.message || "Could not reach the NOC.") +
            " You can continue and save these settings anyway."
        );
        return;
      }
      probeOkFor = key;
      goWizardStep(2);
    } catch (err) {
      allowSkipProbe = true;
      btn.textContent = "Continue anyway";
      wizardError(err.message + " You can continue and save these settings anyway.");
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (wizardStep === 2) {
    const rw = document.getElementById("wiz-rw").value.trim();
    const cfId = document.getElementById("wiz-cf-id").value.trim();
    const cfSecret = document.getElementById("wiz-cf-secret").value.trim();
    if (!isHttpUrl(rw)) {
      wizardError("Metrics remote write URL must start with https:// or http://.");
      return;
    }
    if ((cfId && !cfSecret && !savedConfig?.cfAccessClientSecret) || (!cfId && cfSecret)) {
      wizardError("Cloudflare Access needs both a client ID and a client secret, or leave both blank.");
      return;
    }
    goWizardStep(3);
    return;
  }
  if (wizardStep === 3) {
    if (!document.getElementById("wiz-ping1").value.trim() || !document.getElementById("wiz-ping2").value.trim()) {
      wizardError("Both ping targets are required.");
      return;
    }
    if (!document.getElementById("wiz-community").value.trim()) {
      wizardError("Enter a default SNMP community.");
      return;
    }
    goWizardStep(4);
    return;
  }
  btn.disabled = true;
  try {
    const body = {
      siteName: wizardSiteId(),
      nocApiUrl: document.getElementById("wiz-noc").value.trim(),
      collectorToken: document.getElementById("wiz-token").value.trim(),
      centralRemoteWriteUrl: document.getElementById("wiz-rw").value.trim(),
      cfAccessClientId: document.getElementById("wiz-cf-id").value.trim(),
      cfAccessClientSecret: document.getElementById("wiz-cf-secret").value.trim(),
      pingTarget1: document.getElementById("wiz-ping1").value.trim(),
      pingTarget2: document.getElementById("wiz-ping2").value.trim(),
      snmpCommunity: document.getElementById("wiz-community").value.trim()
    };
    const result = await api("/api/config", { method: "POST", body: JSON.stringify(body) });
    wizardDismissed = true;
    hideWizard();
    await loadConfigForm();
    await refreshDashboard();
    document.querySelector('[data-tab="dashboard"]').click();
    showMsg(
      document.getElementById("sync-msg"),
      result.sync?.message || "Collector setup saved.",
      result.sync ? result.sync.ok !== false : true
    );
  } catch (err) {
    wizardError(err.message);
  } finally {
    btn.disabled = false;
  }
}

function resetProbe() {
  probeOkFor = "";
  allowSkipProbe = false;
  if (wizardStep === 1) document.getElementById("wizard-next").textContent = "Test and continue";
}

document.getElementById("wiz-site").addEventListener("change", () => {
  const custom = document.getElementById("wiz-site").value === "__custom__";
  document.getElementById("wiz-site-custom-row").hidden = !custom;
  resetProbe();
});
["wiz-noc", "wiz-token", "wiz-site-custom"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => resetProbe());
});
document.getElementById("wizard-next").addEventListener("click", () => wizardNext());
document.getElementById("wizard-back").addEventListener("click", () => goWizardStep(wizardStep - 1));
document.getElementById("wizard-advanced").addEventListener("click", () => {
  copyWizardToSetupForm();
  wizardDismissed = true;
  hideWizard();
  document.querySelector('[data-tab="setup"]').click();
});
document.getElementById("btn-open-guide").addEventListener("click", () => {
  wizardDismissed = false;
  wizardPrefillDone = false;
  wizardStep = 0;
  probeOkFor = "";
  showWizard();
});

(async () => {
  await loadCatalog();
  await loadConfigForm();
  await refreshDashboard();
  setInterval(refreshDashboard, 15000);
})();

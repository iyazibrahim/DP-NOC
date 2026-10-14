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
  if (s === "warning") return statusPill("warn", "Degraded");
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

  cards.innerHTML = `
    <div class="card"><div class="label">Site</div><div class="value">${escapeHtml(status.siteName || "—")}</div></div>
    <div class="card"><div class="label">Alloy</div><div class="value">${alloy}</div></div>
    <div class="card"><div class="label">Dashboard</div><div class="value">${dashHtml}</div></div>
    <div class="card"><div class="label">Devices</div><div class="value">${status.deviceCount ?? 0}</div></div>
    <div class="card"><div class="label">SNMP config</div><div class="value">${
      status.configUnsafe
        ? '<span class="bad">Unsafe — repair</span>'
        : status.snmpConfigStale
          ? `<span class="bad">Stale — Force apply</span>${
              status.snmpStaleReason?.detail
                ? `<div class="warn" style="font-size:0.8rem;margin-top:4px">${escapeHtml(status.snmpStaleReason.detail)}</div>`
                : ""
            }`
          : status.snmpBlockPresent === false && (status.deviceCount ?? 0) > 0
            ? '<span class="bad">Missing block</span>'
            : '<span class="ok">Applied</span>'
    }</div></div>
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
    <div class="card"><div class="label">Last sync</div><div class="value" style="font-size:0.9rem">${fmtTime(sync?.at)}</div></div>
    <div class="card" style="grid-column:1/-1"><div class="label">Sync status</div><div class="value" style="font-size:0.9rem">${syncLabel}</div></div>
    ${
      (status.warnings && status.warnings.length
        ? status.warnings
        : status.warning
          ? [status.warning]
          : []
      )
        .map(
          (w) =>
            `<div class="card" style="grid-column:1/-1"><div class="label">Warning</div><div class="value" style="font-size:0.9rem;color:#f0c14a">${escapeHtml(w)}</div></div>`
        )
        .join("")
    }
  `;

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

function renderDevicesTable() {
  const body = document.getElementById("devices-body");
  if (!Array.isArray(cachedDevices) || cachedDevices.length === 0) {
    body.innerHTML =
      '<tr><td colspan="6" class="hint">No devices yet — click Add device, or Sync now to pull from NOC.</td></tr>';
    return;
  }
  body.innerHTML = cachedDevices
    .map((d) => {
      const st = statusById[d.id];
      const pill = deviceStatePill(st?.state);
      const notes = st?.notes
        ? `<div class="hint" title="${escapeHtml(st.notes)}">${escapeHtml(st.notes)}</div>`
        : "";
      return `<tr>
        <td>${escapeHtml(d.name || "")}<div class="hint"><code>${escapeHtml(d.id || "")}</code></div></td>
        <td>${pill}${notes}</td>
        <td>${escapeHtml(d.snmpIp || "")}</td>
        <td>${escapeHtml(d.snmpCommunity || "default")}</td>
        <td>${escapeHtml(d.type || "")}</td>
        <td><button type="button" class="secondary btn-sm" data-edit="${escapeHtml(d.id || "")}">Edit</button></td>
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
  if (!status.configured) {
    document.querySelector('[data-tab="setup"]').click();
  }
}

async function loadCatalog() {
  const catalog = await api("/api/catalog");
  const sel = document.getElementById("siteName");
  sel.innerHTML = catalog
    .map(
      (s) =>
        `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`
    )
    .join("");
}

async function loadConfigForm() {
  const cfg = await api("/api/config");
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

document.getElementById("btn-scan-clients").addEventListener("click", async () => {
  const msg = document.getElementById("snmp-modal-msg");
  const btn = document.getElementById("btn-scan-clients");
  btn.disabled = true;
  try {
    const result = await api("/api/scan-clients", { method: "POST", body: "{}" });
    showMsg(msg, result.message || "Client scan complete", result.ok !== false);
  } catch (e) {
    showMsg(msg, e.message, false);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-refresh").addEventListener("click", () => refreshDashboard());
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

(async () => {
  await loadCatalog();
  await loadConfigForm();
  await refreshDashboard();
  setInterval(refreshDashboard, 15000);
})();

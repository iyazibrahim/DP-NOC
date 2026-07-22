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

function renderStatus(status) {
  const cards = document.getElementById("status-cards");
  const alloy = status.alloyRunning ? '<span class="ok">Running</span>' : '<span class="bad">Stopped</span>';
  const noc =
    status.nocReachable === null
      ? '<span class="warn">Not configured</span>'
      : status.nocReachable
        ? '<span class="ok">Reachable</span>'
        : '<span class="bad">Unreachable</span>';
  const sync = status.lastSync;
  const syncLabel = sync
    ? sync.ok
      ? `<span class="ok">${sync.message}</span>`
      : `<span class="bad">${sync.message}</span>`
    : '<span class="warn">No sync yet</span>';

  cards.innerHTML = `
    <div class="card"><div class="label">Site</div><div class="value">${status.siteName || "—"}</div></div>
    <div class="card"><div class="label">Alloy</div><div class="value">${alloy}</div></div>
    <div class="card"><div class="label">NOC API</div><div class="value">${noc}</div></div>
    <div class="card"><div class="label">Devices</div><div class="value">${status.deviceCount ?? 0}</div></div>
    <div class="card"><div class="label">SNMP config</div><div class="value">${
      status.snmpConfigStale
        ? '<span class="bad">Stale — Force apply</span>'
        : '<span class="ok">Applied</span>'
    }</div></div>
    <div class="card"><div class="label">Last sync</div><div class="value" style="font-size:0.9rem">${fmtTime(sync?.at)}</div></div>
    <div class="card" style="grid-column:1/-1"><div class="label">Sync status</div><div class="value" style="font-size:0.9rem">${syncLabel}</div></div>
  `;
}

async function loadDevices() {
  const devices = await api("/api/devices");
  const body = document.getElementById("devices-body");
  if (!Array.isArray(devices) || devices.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="hint">No devices yet — use Add SNMP device above, or Sync now to pull from NOC.</td></tr>';
    return;
  }
  body.innerHTML = devices
    .map(
      (d) =>
        `<tr><td>${escapeHtml(d.name || "")}</td><td><code>${escapeHtml(d.id || "")}</code></td><td>${escapeHtml(d.snmpIp || "")}</td><td>${escapeHtml(d.type || "")}</td></tr>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`)
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
    document.getElementById("collectorToken").placeholder = cfg.collectorToken + " (saved — enter new to replace)";
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

document.getElementById("btn-refresh").addEventListener("click", () => refreshDashboard());
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
  out.hidden = false;
  try {
    const diag = await api("/api/diagnostics");
    out.textContent = JSON.stringify(diag, null, 2);
  } catch (e) {
    out.textContent = e.message;
  }
});

document.getElementById("add-device-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("add-device-msg");
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const fd = new FormData(form);
  const body = {
    name: String(fd.get("name") || "").trim(),
    snmpIp: String(fd.get("snmpIp") || "").trim(),
    type: String(fd.get("type") || "switch").trim(),
    vendor: String(fd.get("vendor") || "generic").trim(),
    id: String(fd.get("id") || "").trim() || undefined
  };
  btn.disabled = true;
  try {
    const result = await api("/api/devices", { method: "POST", body: JSON.stringify(body) });
    showMsg(msg, result.message || "Device added", result.ok !== false);
    form.reset();
    document.getElementById("dev-vendor").value = "generic";
    document.getElementById("dev-type").value = "firewall";
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

// ═══════════════════════════════════════════════════════
// Yoke Extension — Side Panel Controller
// Fetches from satellite APIs, caches locally, renders natively
// ═══════════════════════════════════════════════════════

const API = {
  quick:  (d) => `https://yoke.lol/api/quick/${d}`,
  xhttp:  (d) => `https://xhttp.lol/${d}`,
  ns:     (d) => `https://ns.lol/${d}`,
  certs:  (d) => `https://certs.lol/${d}`,
  // Deep links to full reports
  yokeReport:  (d) => `https://yoke.lol/${d}`,
  xhttpReport: (d) => `https://xhttp.lol/${d}`,
  nsReport:    (d) => `https://ns.lol/${d}`,
  certsReport: (d) => `https://certs.lol/${d}`,
};

const CACHE_TTL = {
  xhttp: 15 * 60_000,  // 15 min
  ns:     5 * 60_000,  //  5 min
  certs: 60 * 60_000,  //  1 hour
};

const DEEP_LINKS = {
  overview: { text: "Full report on yoke.lol", tool: null,    fn: API.yokeReport },
  headers:  { text: "Full analysis on xhttp.lol", tool: "xhttp", fn: API.xhttpReport },
  dns:      { text: "Full lookup on ns.lol",   tool: "ns",    fn: API.nsReport },
  tls:      { text: "Full inspect on certs.lol", tool: "certs",  fn: API.certsReport },
};

// ── State ──
let currentDomain = null;
let activeTab = "overview";
const cache = {};  // { domain: { xhttp: { data, ts }, ns: {...}, certs: {...} } }
let history = [];
const MAX_HISTORY = 20;

// ── DOM ──
const $input      = document.getElementById("domain-input");
const $btnRefresh = document.getElementById("btn-refresh");
const $deepLink   = document.getElementById("deep-link");
const $deepText   = document.getElementById("deep-link-text");
const $cachedLabel= document.getElementById("cached-label");
const $copyToast  = document.getElementById("copy-toast");
const $historySection = document.getElementById("history-section");
const $historyList    = document.getElementById("history-list");
const $historyToggle  = document.getElementById("history-toggle");
const tabs = {
  overview: document.getElementById("tab-overview"),
  headers:  document.getElementById("tab-headers"),
  dns:      document.getElementById("tab-dns"),
  tls:      document.getElementById("tab-tls"),
};

// ═══════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════

function extractDomain(url) {
  try {
    const u = new URL(url);
    if (["chrome:", "chrome-extension:", "about:", "edge:"].includes(u.protocol)) return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function gradeColor(grade) {
  if (!grade) return "dim";
  const g = grade[0].toUpperCase();
  if (g === "A") return "ok";
  if (g === "B") return "info";
  if (g === "C") return "warn";
  return "err";
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function daysUntil(dateStr) {
  const diff = new Date(dateStr) - Date.now();
  return Math.floor(diff / 86_400_000);
}

function esc(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    $copyToast.classList.add("show");
    setTimeout(() => $copyToast.classList.remove("show"), 1200);
  });
}

function parseCN(dn) {
  if (!dn) return dn;
  const m = dn.match(/CN=([^,]+)/);
  return m ? m[1] : dn;
}

// ═══════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════

function getCached(domain, key) {
  const entry = cache[domain]?.[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL[key]) {
    delete cache[domain][key];
    return null;
  }
  return entry;
}

function setCache(domain, key, data) {
  if (!cache[domain]) cache[domain] = {};
  cache[domain][key] = { data, ts: Date.now() };
}

// ═══════════════════════════════════════════════════════
// API Fetching
// ═══════════════════════════════════════════════════════

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchWithCache(domain, key, urlFn) {
  const cached = getCached(domain, key);
  if (cached) return { data: cached.data, fromCache: true, ts: cached.ts };
  const data = await fetchJSON(urlFn(domain));
  setCache(domain, key, data);
  return { data, fromCache: false, ts: Date.now() };
}

// ═══════════════════════════════════════════════════════
// Renderers
// ═══════════════════════════════════════════════════════

function renderLoading(el) {
  el.innerHTML = `<div class="loading">Scanning…</div>`;
}

function renderError(el, msg) {
  el.innerHTML = `<div class="error-state">${esc(msg)}</div>`;
}

// ── Overview ──
function renderOverview(xhttp, ns, certs, status) {
  const el = tabs.overview;
  const st = status || { xhttp: "done", ns: "done", certs: "done" };

  // Progress indicator
  const loading = [];
  if (st.xhttp === "loading") loading.push("headers");
  if (st.ns === "loading") loading.push("DNS");
  if (st.certs === "loading") loading.push("TLS");

  let html = "";
  if (loading.length) {
    html += `<div class="scan-progress">Scanning ${loading.join(", ")}…</div>`;
  }

  // Header grade
  const hGrade = xhttp?.security_headers?.grade || xhttp?.grade || (st.xhttp === "loading" ? "…" : "—");
  const tGrade = certs?.grade || (st.certs === "loading" ? "…" : "—");
  const expDays = certs?.valid_to ? daysUntil(certs.valid_to) : null;
  const expLabel = expDays !== null ? (expDays > 0 ? `✓ ${expDays}d` : `✗ expired`) : (st.certs === "loading" ? "…" : "—");
  const expColor = expDays === null ? "dim" : expDays > 30 ? "ok" : expDays > 0 ? "warn" : "err";

  html += `<div class="grade-row">
    <div class="grade-card">
      <div class="grade-letter ${gradeColor(hGrade)}">${esc(hGrade)}</div>
      <div class="grade-label">Headers</div>
    </div>
    <div class="grade-card">
      <div class="grade-letter ${gradeColor(tGrade)}">${esc(tGrade)}</div>
      <div class="grade-label">TLS</div>
    </div>
    <div class="grade-card">
      <div style="font-size:18px;font-weight:700;font-family:var(--font-mono)" class="${expColor}">${expLabel}</div>
      <div class="grade-label">Cert Expiry</div>
    </div>
  </div>`;

  // Alerts
  const alerts = [];
  if (xhttp?.security_headers) {
    const hdrs = xhttp.security_headers.headers || {};
    for (const [name, info] of Object.entries(hdrs)) {
      if (info && !info.present) {
        alerts.push({ severity: "warn", text: `<strong>${esc(name)}</strong> header not set` });
      }
    }
  }
  if (certs?.valid_to) {
    if (expDays !== null && expDays <= 30 && expDays > 0) {
      alerts.push({ severity: "warn", text: `Certificate expires in <strong>${expDays} days</strong>` });
    } else if (expDays !== null && expDays <= 0) {
      alerts.push({ severity: "err", text: `Certificate <strong>expired</strong>` });
    }
  }
  if (ns?.summary?.dnssec === "unsigned") {
    alerts.push({ severity: "info", text: `DNSSEC is <strong>not enabled</strong>` });
  }

  if (alerts.length) {
    html += `<div class="section-header">Alerts</div>`;
    for (const a of alerts.slice(0, 5)) {
      const icon = a.severity === "err" ? "✗" : a.severity === "warn" ? "⚠" : "ℹ";
      html += `<div class="alert-row">
        <span class="alert-icon ${a.severity}">${icon}</span>
        <span class="alert-text">${a.text}</span>
      </div>`;
    }
  }

  // Domain info (from NS)
  const aRecords = ns?.records?.A?.records || [];
  const nsRecords = ns?.records?.NS?.records || [];
  if (aRecords.length || nsRecords.length) {
    html += `<div class="section-header">Domain</div>`;
    if (aRecords.length) {
      html += row("IP", aRecords[0].data, "dim", aRecords[0].data);
    }
    if (nsRecords.length) {
      const nsProvider = guessNSProvider(nsRecords[0].data);
      html += row("Nameservers", nsProvider || nsRecords[0].data.replace(/\.$/, ""), "dim");
    }
    html += row("DNS Records", `${ns?.summary?.total_records || "—"} records`, "dim");
    html += row("DNSSEC", ns?.summary?.dnssec === "signed" ? "✓ Signed" : "Unsigned",
      ns?.summary?.dnssec === "signed" ? "ok" : "dim");
  }

  // TLS summary
  if (certs) {
    html += `<div class="section-header">TLS</div>`;
    html += row("Issuer", parseCN(certs.issuer), "dim");
    html += row("Protocol", certs.protocols?.[0] || "—", "dim");
    html += row("Key", `${certs.key_alg || "—"} ${certs.key_size || ""}`, "dim");
    html += row("SANs", `${certs.sans?.length || 0} domains`, "dim");
  }

  // Cache info
  if (xhttp?.cache?.cdn_provider) {
    html += `<div class="section-header">Infrastructure</div>`;
    html += row("CDN", xhttp.cache.cdn_provider, "dim");
    if (xhttp.tls?.version) html += row("Connection", xhttp.tls.version, "dim");
  }

  el.innerHTML = html;

  // Set badge — alert-only (red "!" for serious issues, clean otherwise)
  // Only update badge once all APIs have finished (avoid premature "no issues")
  const allDone = st.xhttp !== "loading" && st.ns !== "loading" && st.certs !== "loading";
  if (allDone && currentDomain) {
    const serious = [];
    if (expDays !== null && expDays <= 0) serious.push("SSL certificate expired");
    else if (expDays !== null && expDays <= 14) serious.push(`SSL cert expires in ${expDays}d`);
    const tg = (tGrade || "").toUpperCase();
    if (tg === "D" || tg === "F" || tg === "T") serious.push(`TLS grade: ${tGrade}`);
    const hg = (hGrade || "").toUpperCase();
    if (hg === "D" || hg === "F") serious.push(`Security headers grade: ${hGrade}`);
    if (xhttp?.security_headers?.headers) {
      const h = xhttp.security_headers.headers;
      if (h["strict-transport-security"] && !h["strict-transport-security"].present) serious.push("Missing HSTS header");
    }
    if (xhttp?.redirects) {
      const chain = Array.isArray(xhttp.redirects) ? xhttp.redirects : [];
      const httpOnly = chain.length > 0 && chain.every(r => (r.url || "").startsWith("http://"));
      if (httpOnly) serious.push("No HTTPS redirect");
    }

    chrome.runtime.sendMessage({
      type: "SET_BADGE",
      domain: currentDomain,
      alert: serious.length > 0,
      tooltip: serious.length > 0
        ? `⚠ ${serious.join(" · ")}`
        : "No critical issues detected",
    }).catch(() => {});
  }
}

// ── Headers Tab (xhttp) ──
function renderHeaders(data) {
  const el = tabs.headers;
  const sh = data.security_headers || {};
  const grade = sh.grade || data.grade || "—";
  const headers = sh.headers || {};
  const present = Object.values(headers).filter(h => h?.present).length;
  const total = Object.keys(headers).length;

  let html = `<div class="grade-row">
    <div class="grade-card" style="flex:none;width:68px">
      <div class="grade-letter ${gradeColor(grade)}">${esc(grade)}</div>
      <div class="grade-label">Grade</div>
    </div>
    <div style="flex:1;display:flex;align-items:center;padding-left:8px">
      <span style="font-size:12px;color:var(--text-secondary);font-family:var(--font-mono)">${present}/${total} security headers</span>
    </div>
  </div>`;

  // Security headers
  html += `<div class="section-header">Security Headers</div>`;
  for (const [name, info] of Object.entries(headers)) {
    const icon = info.present ? "✓" : "✗";
    const color = info.present ? "ok" : "warn";
    html += `<div class="row" onclick="copyToClipboard('${esc(name)}: ${esc(info.value || "")}')">
      <span class="row-label">${esc(name)}</span>
      <span class="${color}">${icon}</span>
    </div>`;
  }

  // Redirect chain
  const rc = data.redirect_chain || {};
  const chain = rc.chain || [];
  if (chain.length) {
    html += collapseHeader(`Redirect Chain`, `(${rc.hops || chain.length - 1} hop${(rc.hops || chain.length - 1) !== 1 ? "s" : ""})`, true);
    html += `<div class="collapse-body open"><div class="chain">`;
    for (let i = 0; i < chain.length; i++) {
      const hop = chain[i];
      const code = hop.status || "—";
      const codeClass = code >= 300 && code < 400 ? "info" : code >= 200 && code < 300 ? "ok" : "warn";
      html += `<div class="chain-hop">
        <span class="chain-code" style="background:var(--${codeClass}-bg);color:var(--${codeClass})">${code}</span>
        <span class="chain-url">${esc(hop.url)}</span>
      </div>`;
      if (i < chain.length - 1) html += `<div class="chain-hop"><span class="chain-arrow">↓</span></div>`;
    }
    html += `</div></div>`;
  }

  // CORS
  if (data.cors) {
    const cors = data.cors;
    html += collapseHeader("CORS Policy", "", false);
    let corsHtml = `<div class="collapse-body">`;
    corsHtml += `<div class="row"><span class="row-label">Enabled</span><span class="${cors.enabled ? "ok" : "dim"}">${cors.enabled ? "Yes" : "No"}</span></div>`;
    if (cors.allow_origin) corsHtml += `<div class="row"><span class="row-label">Allow-Origin</span><span class="row-value dim">${esc(cors.allow_origin)}</span></div>`;
    if (cors.allow_methods?.length) corsHtml += `<div class="row"><span class="row-label">Methods</span><span class="row-value dim">${esc(cors.allow_methods.join(", "))}</span></div>`;
    corsHtml += `</div>`;
    html += corsHtml;
  }

  // Cache
  if (data.cache) {
    const ca = data.cache;
    html += collapseHeader("Cache", "", false);
    let caHtml = `<div class="collapse-body">`;
    if (ca.cdn_provider) caHtml += `<div class="row"><span class="row-label">CDN</span><span class="row-value dim">${esc(ca.cdn_provider)}</span></div>`;
    if (ca.cache_control) caHtml += `<div class="row"><span class="row-label">Cache-Control</span><span class="row-value dim" style="font-size:10px">${esc(ca.cache_control)}</span></div>`;
    if (ca.effective_ttl) caHtml += `<div class="row"><span class="row-label">Effective TTL</span><span class="row-value dim">${ca.effective_ttl}s</span></div>`;
    caHtml += `</div>`;
    html += caHtml;
  }

  el.innerHTML = html;
  bindCollapsibles(el);
}

// ── DNS Tab (ns) ──
function renderDNS(data) {
  const el = tabs.dns;
  const summary = data.summary || {};
  const records = data.records || {};

  // Propagation / DNSSEC bar
  let html = `<div class="prop-bar">`;
  if (summary.dnssec === "signed") {
    html += `<span class="badge badge-ok" style="font-size:9px">DNSSEC ✓</span>`;
  } else {
    html += `<span class="badge badge-info" style="font-size:9px">DNSSEC unsigned</span>`;
  }
  html += `<span style="flex:1"></span>`;
  html += `<span style="color:var(--muted);font-size:10px;font-family:var(--font-mono)">${summary.total_records || 0} records · ${summary.avg_query_time_ms || 0}ms avg</span>`;
  html += `</div>`;

  // Record type order
  const order = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "SRV", "CAA", "DNSKEY", "DS"];
  const seen = new Set();

  for (const type of order) {
    if (!records[type]?.records?.length) continue;
    seen.add(type);
    const recs = records[type].records;
    const isCollapsible = recs.length > 4;

    if (isCollapsible) {
      html += collapseHeader(`${type} Records`, `(${recs.length})`, false);
      html += `<div class="collapse-body">`;
    } else {
      html += `<div class="section-header">${type} Records</div>`;
    }

    for (const r of recs) {
      html += `<div class="dns-record" onclick="copyToClipboard('${esc(r.data)}')">
        <span class="dns-type">${esc(r.type)}</span>
        <span class="dns-value">${esc(r.data?.replace(/\.$/, ""))}</span>
        <span class="dns-ttl">${esc(r.ttl_human || r.TTL + "s")}</span>
      </div>`;
    }

    if (isCollapsible) html += `</div>`;
  }

  // Any remaining types
  for (const [type, group] of Object.entries(records)) {
    if (seen.has(type) || !group?.records?.length) continue;
    html += `<div class="section-header">${esc(type)} Records</div>`;
    for (const r of group.records) {
      html += `<div class="dns-record" onclick="copyToClipboard('${esc(r.data)}')">
        <span class="dns-type">${esc(r.type)}</span>
        <span class="dns-value">${esc(r.data?.replace(/\.$/, ""))}</span>
        <span class="dns-ttl">${esc(r.ttl_human || r.TTL + "s")}</span>
      </div>`;
    }
  }

  el.innerHTML = html;
  bindCollapsibles(el);
}

// ── TLS Tab (certs) ──
function renderTLS(data) {
  const el = tabs.tls;
  const grade = data.grade || "—";
  const protos = data.protocols || [];
  const topProto = protos[0] || "—";

  let html = `<div class="grade-row">
    <div class="grade-card" style="flex:none;width:68px">
      <div class="grade-letter ${gradeColor(grade)}">${esc(grade)}</div>
      <div class="grade-label">Grade</div>
    </div>
    <div style="flex:1;display:flex;align-items:center;padding-left:8px">
      <span style="font-size:12px;color:var(--text-secondary);font-family:var(--font-mono)">${esc(topProto)} · ${esc(data.key_alg || "")} ${data.key_size || ""}</span>
    </div>
  </div>`;

  // Cert details
  const expDays = data.valid_to ? daysUntil(data.valid_to) : null;
  const expColor = expDays === null ? "" : expDays > 30 ? "ok" : expDays > 0 ? "warn" : "err";

  html += `<div class="cert-grid" style="border-bottom:1px solid var(--border-muted)">
    <div><div class="cert-label">Issuer</div><div class="cert-val">${esc(parseCN(data.issuer))}</div></div>
    <div><div class="cert-label">Subject</div><div class="cert-val">${esc(parseCN(data.subject))}</div></div>
    <div><div class="cert-label">Valid From</div><div class="cert-val">${esc(data.valid_from?.split("T")[0])}</div></div>
    <div><div class="cert-label">Expires</div><div class="cert-val ${expColor}">${esc(data.valid_to?.split("T")[0])}${expDays !== null ? ` (${expDays}d)` : ""}</div></div>
    <div><div class="cert-label">Serial</div><div class="cert-val" style="font-size:10px">${esc(data.serial?.substring(0, 12))}…</div></div>
    <div><div class="cert-label">SANs</div><div class="cert-val">${data.sans?.length || 0} domains</div></div>
  </div>`;

  // Protocol support
  const allProtos = ["TLS 1.3", "TLS 1.2", "TLS 1.1", "TLS 1.0", "SSL 3.0"];
  html += `<div class="section-header">Protocol Support</div>`;
  for (const p of allProtos) {
    const supported = protos.includes(p);
    html += `<div class="proto-row">
      <span style="color:var(--text-secondary)">${esc(p)}</span>
      <span class="${supported ? "ok" : "dim"}">${supported ? "✓" : "✗"}</span>
    </div>`;
  }

  // Certificate chain
  if (data.chain_certs?.length) {
    html += collapseHeader("Certificate Chain", `(${data.chain_certs.length} certs)`, false);
    html += `<div class="collapse-body">`;
    for (let i = 0; i < data.chain_certs.length; i++) {
      const cert = data.chain_certs[i];
      const dotColor = i === 0 ? "ok" : i === data.chain_certs.length - 1 ? "dim" : "info";
      html += `<div class="row" style="padding-left:${12 + i * 12}px">
        <span class="row-label" style="gap:4px"><span class="${dotColor}">●</span> ${esc(parseCN(cert.subject))}</span>
        <span class="row-value dim" style="font-size:10px">${esc(cert.key_alg)} ${cert.key_size || ""}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // SANs
  if (data.sans?.length > 1) {
    html += collapseHeader("Subject Alt Names", `(${data.sans.length})`, false);
    html += `<div class="collapse-body">`;
    for (const san of data.sans) {
      html += `<div class="row" onclick="copyToClipboard('${esc(san)}')">
        <span class="row-label">${esc(san)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  el.innerHTML = html;
  bindCollapsibles(el);
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function row(label, value, colorClass, copyVal) {
  const onclick = copyVal ? ` onclick="copyToClipboard('${esc(copyVal)}')"` : "";
  return `<div class="row"${onclick}>
    <span class="row-label">${esc(label)}</span>
    <span class="row-value ${colorClass || ""}">${value}</span>
  </div>`;
}

function collapseHeader(title, meta, open) {
  return `<div class="collapse-header${open ? " open" : ""}">
    ${esc(title)} ${meta ? `<span style="color:var(--dim);font-weight:400;text-transform:none">${meta}</span>` : ""}
    <span class="collapse-arrow">▾</span>
  </div>`;
}

function bindCollapsibles(container) {
  container.querySelectorAll(".collapse-header").forEach(h => {
    h.addEventListener("click", () => {
      h.classList.toggle("open");
      const body = h.nextElementSibling;
      if (body?.classList.contains("collapse-body")) body.classList.toggle("open");
    });
  });
}

function guessNSProvider(ns) {
  if (!ns) return null;
  const n = ns.toLowerCase();
  if (n.includes("cloudflare")) return "Cloudflare";
  if (n.includes("awsdns")) return "AWS Route 53";
  if (n.includes("google")) return "Google Cloud DNS";
  if (n.includes("azure")) return "Azure DNS";
  if (n.includes("digitalocean")) return "DigitalOcean";
  if (n.includes("ns1.")) return "NS1";
  if (n.includes("dynect")) return "Dyn";
  if (n.includes("ultradns")) return "UltraDNS";
  if (n.includes("domaincontrol")) return "GoDaddy";
  if (n.includes("registrar-servers")) return "Namecheap";
  return null;
}

// ═══════════════════════════════════════════════════════
// Tab & Deep Link
// ═══════════════════════════════════════════════════════

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.toggle("active", c.id === `tab-${name}`));

  // Update deep link
  const info = DEEP_LINKS[name];
  if (info && currentDomain) {
    $deepText.textContent = info.text;
    $deepLink.href = info.fn(currentDomain);
    if (info.tool) {
      $deepLink.setAttribute("data-tool", info.tool);
    } else {
      $deepLink.removeAttribute("data-tool");
    }
  }

  // Update cached label
  updateCachedLabel(name);

  // Lazy-load tab data if not yet loaded
  if (currentDomain) loadTabData(name);
}

function updateCachedLabel(tabName) {
  const keyMap = { headers: "xhttp", dns: "ns", tls: "certs" };
  const key = keyMap[tabName];
  if (!key || !currentDomain) { $cachedLabel.textContent = ""; return; }
  const entry = cache[currentDomain]?.[key];
  if (entry) {
    $cachedLabel.textContent = `cached ${timeAgo(entry.ts)}`;
  } else {
    $cachedLabel.textContent = "";
  }
}

// ═══════════════════════════════════════════════════════
// Domain Scanning
// ═══════════════════════════════════════════════════════

async function analyzeDomain(domain, force = false) {
  if (!domain) return;
  currentDomain = domain;
  $input.value = domain;
  addToHistory(domain);

  // Clear force cache if needed
  if (force && cache[domain]) delete cache[domain];

  // Load overview immediately (fires all 3 APIs in parallel)
  switchTab("overview");
  await loadOverview(domain);
}

async function loadOverview(domain) {
  const results = { xhttp: null, ns: null, certs: null };
  const status = { xhttp: "loading", ns: "loading", certs: "loading" };

  // Render immediately with loading state
  renderOverviewProgressive(results, status);

  // Fire all 3 in parallel, re-render as each completes
  const fetches = [
    fetchWithCache(domain, "xhttp", API.xhttp)
      .then(r => { results.xhttp = r.data; status.xhttp = "done"; })
      .catch(() => { status.xhttp = "error"; })
      .finally(() => { if (currentDomain === domain) renderOverviewProgressive(results, status); }),
    fetchWithCache(domain, "ns", API.ns)
      .then(r => { results.ns = r.data; status.ns = "done"; })
      .catch(() => { status.ns = "error"; })
      .finally(() => { if (currentDomain === domain) renderOverviewProgressive(results, status); }),
    fetchWithCache(domain, "certs", API.certs)
      .then(r => { results.certs = r.data; status.certs = "done"; })
      .catch(() => { status.certs = "error"; })
      .finally(() => { if (currentDomain === domain) renderOverviewProgressive(results, status); }),
  ];

  await Promise.allSettled(fetches);
  updateCachedLabel("overview");
}

function renderOverviewProgressive(results, status) {
  const { xhttp, ns, certs } = results;
  const allDone = status.xhttp !== "loading" && status.ns !== "loading" && status.certs !== "loading";
  const anyData = xhttp || ns || certs;

  if (allDone && !anyData) {
    renderError(tabs.overview, "Failed to reach all APIs. Check your connection.");
    return;
  }

  renderOverview(xhttp, ns, certs, status);
}

async function loadTabData(tabName) {
  const el = tabs[tabName];
  const keyMap = { headers: "xhttp", dns: "ns", tls: "certs" };
  const key = keyMap[tabName];
  if (!key) return; // overview handled separately
  const urlMap = { xhttp: API.xhttp, ns: API.ns, certs: API.certs };

  // Already have cached data rendered?
  const cached = getCached(currentDomain, key);
  if (cached && el.innerHTML) {
    updateCachedLabel(tabName);
    return;
  }

  // If cached in memory but not rendered
  if (cached) {
    const renderers = { xhttp: renderHeaders, ns: renderDNS, certs: renderTLS };
    renderers[key](cached.data);
    updateCachedLabel(tabName);
    return;
  }

  // Need to fetch
  renderLoading(el);
  try {
    const result = await fetchWithCache(currentDomain, key, urlMap[key]);
    const renderers = { xhttp: renderHeaders, ns: renderDNS, certs: renderTLS };
    renderers[key](result.data);
    updateCachedLabel(tabName);
  } catch (err) {
    renderError(el, `Failed to load ${tabName}: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════

function loadHistory() {
  try {
    const stored = localStorage.getItem("yoke_history");
    history = stored ? JSON.parse(stored) : [];
  } catch { history = []; }
}

function saveHistory() {
  localStorage.setItem("yoke_history", JSON.stringify(history));
}

function addToHistory(domain) {
  history = history.filter(h => h.domain !== domain);
  history.unshift({ domain, ts: Date.now() });
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  if (!history.length) {
    $historySection.style.display = "none";
    return;
  }
  $historySection.style.display = "block";
  $historyList.innerHTML = history
    .filter(h => h.domain !== currentDomain)
    .slice(0, 8)
    .map(h => `<div class="history-item" data-domain="${esc(h.domain)}">
      <span class="history-domain">${esc(h.domain)}</span>
      <span class="history-time">${timeAgo(h.ts)}</span>
    </div>`).join("");

  $historyList.querySelectorAll(".history-item").forEach(item => {
    item.addEventListener("click", () => {
      const d = item.dataset.domain;
      if (d) analyzeDomain(d);
    });
  });
}

// ═══════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════

// Tab clicks
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => switchTab(t.dataset.tab));
});

// Input
$input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = $input.value.trim();
    const domain = extractDomain(`https://${val}`) || val;
    if (domain) analyzeDomain(domain);
  }
});

// Refresh
$btnRefresh.addEventListener("click", () => {
  if (currentDomain) {
    $btnRefresh.classList.add("spin");
    analyzeDomain(currentDomain, true).finally(() => {
      $btnRefresh.classList.remove("spin");
    });
  }
});

// History toggle
$historyToggle.addEventListener("click", () => {
  $historyToggle.classList.toggle("open");
  $historyList.classList.toggle("open");
});

// Messages from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TAB_UPDATED" && msg.url) {
    const domain = extractDomain(msg.url);
    if (domain && domain !== currentDomain) analyzeDomain(domain);
  }
  if (msg.type === "ANALYZE_URL" && msg.url) {
    const domain = extractDomain(msg.url);
    if (domain) analyzeDomain(domain);
  }
});

// ═══════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════

loadHistory();
renderHistory();

// Grab current tab domain
chrome.tabs.query({ active: true, currentWindow: true }, (tabList) => {
  if (tabList[0]?.url) {
    const domain = extractDomain(tabList[0].url);
    if (domain) {
      analyzeDomain(domain);
    } else {
      tabs.overview.innerHTML = `<div class="empty-state">Navigate to a website to analyze it,<br>or enter a domain above.</div>`;
    }
  } else {
    tabs.overview.innerHTML = `<div class="empty-state">Navigate to a website to analyze it,<br>or enter a domain above.</div>`;
  }
});

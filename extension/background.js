// Yoke Extension — Background Service Worker
// Handles: side panel open, tab navigation, context menu, badge grade

// ── Side Panel ──
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// ── Context Menu ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "yoke-analyze",
    title: "Analyze with Yoke",
    contexts: ["page", "link"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "yoke-analyze") return;
  await chrome.sidePanel.open({ tabId: tab.id });
  // If right-clicked a link, send that URL to the panel
  const url = info.linkUrl || info.pageUrl || tab.url;
  if (url) {
    chrome.runtime.sendMessage({ type: "ANALYZE_URL", url }).catch(() => {});
  }
});

// ── Tab Navigation ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    chrome.runtime.sendMessage({ type: "TAB_UPDATED", url: tab.url }).catch(() => {});
    updateBadge(tab);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      chrome.runtime.sendMessage({ type: "TAB_UPDATED", url: tab.url }).catch(() => {});
    }
  } catch {}
});

// ── Badge ──
// Show alert badge (red "!") only for serious issues, clean otherwise
async function updateBadge(tab) {
  const domain = extractDomain(tab.url);
  if (!domain) {
    chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    chrome.action.setTitle({ tabId: tab.id, title: "Yoke — Domain Intelligence" });
    return;
  }
  try {
    const result = await chrome.storage.session.get(`badge_${domain}`);
    const cached = result[`badge_${domain}`];
    if (cached) {
      if (cached.alert) {
        chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#f85149" });
        chrome.action.setTitle({ tabId: tab.id, title: cached.tooltip || "Issues detected" });
      } else {
        chrome.action.setBadgeText({ tabId: tab.id, text: "" });
        chrome.action.setTitle({ tabId: tab.id, title: cached.tooltip || "No critical issues detected" });
      }
    }
  } catch {}
}

// Listen for alert updates from the panel
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SET_BADGE" && msg.domain) {
    chrome.storage.session.set({ [`badge_${msg.domain}`]: { alert: msg.alert, tooltip: msg.tooltip } });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const d = extractDomain(tabs[0].url);
        if (d === msg.domain) {
          if (msg.alert) {
            chrome.action.setBadgeText({ tabId: tabs[0].id, text: "!" });
            chrome.action.setBadgeBackgroundColor({ tabId: tabs[0].id, color: "#f85149" });
            chrome.action.setTitle({ tabId: tabs[0].id, title: msg.tooltip || "Issues detected" });
          } else {
            chrome.action.setBadgeText({ tabId: tabs[0].id, text: "" });
            chrome.action.setTitle({ tabId: tabs[0].id, title: msg.tooltip || "No critical issues detected" });
          }
        }
      }
    });
  }
});

function extractDomain(url) {
  try {
    const u = new URL(url);
    if (["chrome:", "chrome-extension:", "about:", "edge:"].includes(u.protocol)) return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}


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
// Set badge text from cached grade when available
async function updateBadge(tab) {
  const domain = extractDomain(tab.url);
  if (!domain) {
    chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    return;
  }
  try {
    const result = await chrome.storage.session.get(`badge_${domain}`);
    const grade = result[`badge_${domain}`];
    if (grade) {
      chrome.action.setBadgeText({ tabId: tab.id, text: grade });
      chrome.action.setBadgeBackgroundColor({
        tabId: tab.id,
        color: gradeColor(grade)
      });
    }
  } catch {}
}

// Listen for grade updates from the panel
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SET_BADGE" && msg.domain && msg.grade) {
    chrome.storage.session.set({ [`badge_${msg.domain}`]: msg.grade });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const d = extractDomain(tabs[0].url);
        if (d === msg.domain) {
          chrome.action.setBadgeText({ tabId: tabs[0].id, text: msg.grade });
          chrome.action.setBadgeBackgroundColor({
            tabId: tabs[0].id,
            color: gradeColor(msg.grade)
          });
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

function gradeColor(grade) {
  if (!grade) return "#6a6a80";
  const g = grade[0].toUpperCase();
  if (g === "A") return "#3fb950";
  if (g === "B") return "#6ea8fe";
  if (g === "C") return "#d29922";
  return "#f85149";
}

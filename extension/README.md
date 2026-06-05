# Yoke Chrome Extension

Analyze any domain from your browser sidebar — click the Yoke icon to open a side panel with full domain intelligence.

Part of [Yoke](https://github.com/yokedotlol/yoke), the open-source domain intelligence tool.

## Install

**[Install from Chrome Web Store →](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj)**

## How It Works

1. Click the Yoke icon in your browser toolbar
2. A side panel opens with the full Yoke analysis for the current site
3. Navigate to a different site — the panel updates automatically

The extension uses Chrome's [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) to embed the Yoke dashboard in an iframe alongside any page you're browsing. No data leaves your browser beyond the standard Yoke analysis request.

## Features

- **Auto-detect domain** — extracts the domain from your current tab and loads the analysis
- **Live updates** — navigating to a new page automatically refreshes the analysis
- **Full dashboard** — same 9-tab analysis you get on yoke.lol (DNS, SSL, WHOIS, security, tech stack, performance, breaches, AI, and more)
- **Minimal permissions** — only requires `activeTab` (read current tab URL) and `sidePanel`

## Screenshots

*Screenshots coming soon.*

## Development

Load the extension from source for local development:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `extension/` directory from this repo

The extension loads `yoke.lol` in an iframe by default. To point it at a local or self-hosted instance, edit `YOKE_BASE` in `sidepanel.js`:

```js
const YOKE_BASE = "http://localhost:8787";
```

### File Structure

```
extension/
├── manifest.json      # Chrome MV3 manifest
├── background.js      # Service worker — handles tab navigation events
├── sidepanel.html     # Side panel shell with iframe
├── sidepanel.js       # Domain extraction and iframe routing
└── icons/             # Extension icons (16, 32, 48, 128px)
```

## License

MIT — see [LICENSE](../LICENSE).

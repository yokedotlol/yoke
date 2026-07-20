# Yoke Chrome Extension

Analyze any domain from your browser sidebar. Click the Yoke icon to open a native side panel with a compact domain health view.

Part of [Yoke](https://github.com/yokedotlol/yoke), the open-source domain intelligence tool.

## Install

**[Install from Chrome Web Store ->](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj)**

## How it works

1. Click the Yoke icon in your browser toolbar.
2. The side panel extracts the current tab's domain.
3. The panel calls the .lol satellite APIs directly: `xhttp.lol` for headers, `ns.lol` for DNS, and `certs.lol` for TLS.
4. It renders a native overview plus focused headers, DNS, and TLS tabs, with deep links to the full reports on yoke.lol and the satellite tools.

Privacy note: analyzed domains are sent to the .lol APIs listed above. The extension keeps a small local history in browser storage and an in-memory cache for recent results; it does not embed a remote dashboard iframe, create an account, or add third-party tracking.

## Features

- **Auto-detect domain** — extracts the domain from your current tab and starts analysis.
- **Native side panel** — renders the overview, headers, DNS, and TLS views locally in the extension UI.
- **Satellite API integration** — direct reads from xhttp.lol, ns.lol, and certs.lol with links to the full Yoke report.
- **Short-lived local cache** — keeps recent API results in memory so switching tabs is fast.
- **Local history** — stores up to 20 recently analyzed domains in browser local storage.
- **Minimal permissions** — uses `activeTab`, `sidePanel`, `storage`, and host access for the .lol APIs.

## Screenshots

*Screenshots coming soon.*

## Development

Load the extension from source for local development:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` directory from this repo.

The extension API endpoints are defined in `sidepanel.js`. For local development against self-hosted .lol services, update the `API` constants there.

### File structure

```
extension/
├── manifest.json      # Chrome MV3 manifest
├── background.js      # Service worker; tab navigation and badge state
├── sidepanel.html     # Native side panel shell
├── sidepanel.js       # Domain extraction, API calls, caching, and rendering
└── icons/             # Extension icons (16, 32, 48, 128px)
```

## License

MIT — see [LICENSE](../LICENSE).

# Third-Party Notices

This project includes the following third-party components:

## resvg-wasm

- **Source**: https://github.com/nicolo-ribaudo/resvg-js (Cloudflare Workers fork) / https://github.com/nicolo-ribaudo/nicolo-ribaudo.github.io/tree/main/nicolo-resvg-wasm
- **Upstream**: https://github.com/nicolo-ribaudo/nicolo-resvg-wasm (resvg v0.36+)
- **License**: MPL-2.0
- **Files**: `og-worker/src/resvg_bg.wasm`, `og-worker/src/resvg.js`
- **Usage**: SVG → PNG rendering for dynamic OG share card images

## Inter Font

- **Source**: https://github.com/rsms/inter
- **License**: SIL Open Font License 1.1
- **Files**: Embedded as base64 data in `og-worker/src/fonts.ts`
- **Usage**: Typography in generated OG share card images

## retire.js

- **Source**: https://github.com/nicolo-ribaudo/retire.js
- **License**: Apache-2.0
- **Files**: Fetched at runtime via `scripts/seed-kv.sh` into KV storage
- **Usage**: Client-side JavaScript vulnerability detection in JS audit endpoint

## Leaflet

- **Source**: https://github.com/Leaflet/Leaflet
- **License**: BSD-2-Clause
- **Copyright**: Copyright (c) 2010-2023, Volodymyr Agafonkin; Copyright (c) 2010-2011, CloudMade
- **Files**: Bundled via npm (`leaflet` package) into client build
- **Usage**: Interactive IP geolocation maps in analysis results

BSD 2-Clause License:

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## JetBrains Mono

- **Source**: https://github.com/JetBrains/JetBrainsMono
- **License**: SIL Open Font License 1.1
- **Copyright**: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
- **Files**: `client/public/fonts/jetbrains-mono-latin.woff2`
- **Usage**: Monospace typography for code, technical data, and terminal-style UI elements

This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is available with a FAQ at: https://scripts.sil.org/OFL

## React

- **Source**: https://github.com/facebook/react
- **License**: MIT
- **Copyright**: Copyright (c) Meta Platforms, Inc. and affiliates
- **Files**: Bundled via npm (`react`, `react-dom` packages) into client build
- **Usage**: UI framework for the Yoke web application

## TanStack Query (React Query)

- **Source**: https://github.com/TanStack/query
- **License**: MIT
- **Copyright**: Copyright (c) 2021-present Tanner Linsley
- **Files**: Bundled via npm (`@tanstack/react-query` package) into client build
- **Usage**: Server state management and data fetching for the client application

## Lucide React

- **Source**: https://github.com/lucide-icons/lucide
- **License**: ISC
- **Copyright**: Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
- **Files**: Bundled via npm (`lucide-react` package) into client build
- **Usage**: Icon set used throughout the Yoke UI

## MaxMind GeoLite2

- **Source**: https://www.maxmind.com/en/geolite2/signup
- **License**: MaxMind GeoLite2 End User License Agreement (https://www.maxmind.com/en/geolite2/eula)
- **Copyright**: Copyright (c) MaxMind, Inc.
- **Files**: `GeoLite2-City.mmdb`, `GeoLite2-ASN.mmdb` (loaded at runtime in the Fly.io proxy, not distributed in the repository)
- **Usage**: IP geolocation (city, country) and ASN/ISP identification for analyzed domains

This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.

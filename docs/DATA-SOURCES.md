# Data Sources & Acknowledgments

Yoke pulls data from a variety of third-party services to build its domain intelligence reports. This page lists every external data source, what we use it for, and any required attributions.

---

## Data Sources

| Service | What Yoke Uses It For | Terms / License | Link |
|---------|----------------------|-----------------|------|
| **Google PageSpeed Insights** | Core Web Vitals, performance scores, and Lighthouse audits | [Google APIs ToS](https://developers.google.com/terms) — free, no key required | [developers.google.com/speed](https://developers.google.com/speed/pagespeed/insights/) |
| **Yoke Fly Probe** | Direct TLS handshake, cipher enumeration, OCSP stapling, CT SCTs, forward secrecy, HTTP content fallback | Self-hosted (MIT) | Self-hosted on Fly.io |
| **Have I Been Pwned** | Data breach exposure lookups for domains | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — attribution required | [haveibeenpwned.com](https://haveibeenpwned.com) |
| **crt.sh** | Certificate Transparency log searches | Public, no key required | [crt.sh](https://crt.sh) |
| **Cert Spotter (SSLMate)** | Certificate Transparency monitoring | Free tier, no key required | [sslmate.com/certspotter](https://sslmate.com/certspotter) |
| **Shodan InternetDB** | Open port and known-vulnerability lookups | Free public API, no key required | [internetdb.shodan.io](https://internetdb.shodan.io) |
| **GreyNoise** | Internet background noise and scanner classification | [Community API](https://docs.greynoise.io/docs/using-the-greynoise-community-api) — free, rate-limited | [greynoise.io](https://greynoise.io) |
| **Google Public DNS** | DNS record resolution (via DNS-over-HTTPS) | [Google APIs ToS](https://developers.google.com/terms) — free, no key required | [dns.google](https://dns.google) |
| **WhoisFreaks** | WHOIS registration data lookups | API key required, free tier available | [whoisfreaks.com](https://whoisfreaks.com) |
| **Google RDAP** | Domain registration data via the RDAP protocol | Public RDAP protocol, no key required | [Google Registry](https://pubapi.registry.google/rdap) |
| **Cloudflare API** | Domain availability checks | [Cloudflare ToS](https://www.cloudflare.com/terms/) — API key required | [cloudflare.com](https://www.cloudflare.com) |
| **Tranco** | Domain popularity ranking | Research use, [citation requested](https://tranco-list.eu/about) | [tranco-list.eu](https://tranco-list.eu) |
| **Brandfetch** | Brand logos and visual identity | [Brand Search API](https://docs.brandfetch.com/) — free up to 500K req/mo, no key required | [brandfetch.com](https://brandfetch.com) |
| **Wikidata** | Structured entity data (organization info, founding date, etc.) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain | [wikidata.org](https://www.wikidata.org) |
| **Green Web Foundation** | Green/sustainable hosting checks | [ODbL](https://opendatacommons.org/licenses/odbl/) — open data | [thegreenwebfoundation.org](https://www.thegreenwebfoundation.org) |
| **Website Carbon** | Estimated carbon footprint per page load | Free API | [websitecarbon.com](https://www.websitecarbon.com) |
| **Wayback Machine** | Historical snapshot availability via the Internet Archive | Free public API | [web.archive.org](https://web.archive.org) |
| **HackerTarget** | Supplementary reconnaissance lookups | Free tier, rate-limited | [hackertarget.com](https://hackertarget.com) |
| **ipwho.is** | IP geolocation (HTTPS fallback, used by both Worker and Fly proxy) | Free, no key required | [ipwho.is](https://ipwho.is) |
| **OpenRouter** | LLM inference proxy (powers AI-generated analysis) | [OpenRouter ToS](https://openrouter.context/terms) — BYO key or platform key | [openrouter.ai](https://openrouter.ai) |
| **check-host.net** | Global HTTP availability probes from 20+ worldwide locations (relayed via Fly proxy) | Free public API | [check-host.net](https://check-host.net) |
| **MaxMind GeoLite2** | Local IP geolocation database (city, country, ASN/ISP) used in Fly proxy | [GeoLite2 EULA](https://www.maxmind.com/en/geolite2/eula) — attribution required | [maxmind.com](https://www.maxmind.com/en/geolite2/signup) |
| **CARTO** | Dark-themed map tile layer for IP geolocation maps | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [carto.com](https://carto.com) |
| **OpenStreetMap** | Base map data underlying CARTO tiles | [ODbL](https://opendatacommons.org/licenses/odbl/) — attribution required | [openstreetmap.org](https://www.openstreetmap.org) |
| **Crunchbase** | Company and startup data enrichment | [Crunchbase ToS](https://about.crunchbase.com/terms-of-service/) — public data | [crunchbase.com](https://www.crunchbase.com) |
| **Google News RSS** | Recent news articles mentioning analyzed domains | [Google ToS](https://policies.google.com/terms) — RSS feed, results cached 4h | [news.google.com](https://news.google.com) |

---

## Required Attributions

### Have I Been Pwned

Breach data is sourced from [Have I Been Pwned](https://haveibeenpwned.com), created by Troy Hunt. HIBP data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### Green Web Foundation

Green hosting data provided by [The Green Web Foundation](https://www.thegreenwebfoundation.org), available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).

### Wikidata

Structured data sourced from [Wikidata](https://www.wikidata.org), available under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Wikidata is a project of the Wikimedia Foundation.

### Tranco

Domain ranking data from the [Tranco list](https://tranco-list.eu), a research-grade domain ranking developed by KU Leuven, TU Delft, and Université Grenoble Alpes.

> Le Pochat, V., Van Goethem, T., Tajalizadehkhoob, S., Korczyński, M., & Joosen, W. (2019). *Tranco: A Research-Oriented Top Sites Ranking Hardened Against Manipulation.* Proceedings of NDSS 2019.

### MaxMind GeoLite2

This product includes GeoLite2 data created by [MaxMind](https://www.maxmind.com), available from [https://www.maxmind.com](https://www.maxmind.com). Used under the [GeoLite2 EULA](https://www.maxmind.com/en/geolite2/eula).

### OpenStreetMap

Map data © [OpenStreetMap](https://www.openstreetmap.org) contributors, available under the [Open Data Commons Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Map tiles by [CARTO](https://carto.com), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

---

## Disclaimer

Yoke aggregates publicly available data from the services listed above to produce informational domain reports. All data remains the property of its respective providers. Yoke does not guarantee the accuracy, completeness, or timeliness of third-party data. For authoritative results, consult the original source directly.

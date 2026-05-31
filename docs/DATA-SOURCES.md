# Data Sources & Acknowledgments

Yoke pulls data from a variety of third-party services to build its domain intelligence reports. This page lists every external data source, what we use it for, and any required attributions.

---

## Data Sources

| Service | What Yoke Uses It For | Link |
|---------|----------------------|------|
| **Google PageSpeed Insights** | Core Web Vitals, performance scores, and Lighthouse audits | [developers.google.com/speed](https://developers.google.com/speed/pagespeed/insights/) |
| **Yoke Fly Probe** | Direct TLS handshake, cipher enumeration, OCSP stapling, Certificate Transparency SCTs, forward secrecy, HTTP content fallback | Self-hosted on Fly.io |
| **Have I Been Pwned** | Data breach exposure lookups for domains | [haveibeenpwned.com](https://haveibeenpwned.com) |
| **crt.sh** | Certificate Transparency log searches | [crt.sh](https://crt.sh) |
| **Cert Spotter (SSLMate)** | Certificate Transparency monitoring | [sslmate.com/certspotter](https://sslmate.com/certspotter) |
| **Shodan InternetDB** | Open port and known-vulnerability lookups | [internetdb.shodan.io](https://internetdb.shodan.io) |
| **GreyNoise** | Internet background noise and scanner classification | [greynoise.io](https://greynoise.io) |
| **Google Public DNS** | DNS record resolution (via DNS-over-HTTPS) | [dns.google](https://dns.google) |
| **WhoisFreaks** | WHOIS registration data lookups | [whoisfreaks.com](https://whoisfreaks.com) |
| **Google RDAP** | Domain registration data via the RDAP protocol | [Google Registry](https://pubapi.registry.google/rdap) |
| **Cloudflare API** | Domain availability checks | [cloudflare.com](https://www.cloudflare.com) |
| **Tranco** | Domain popularity ranking | [tranco-list.eu](https://tranco-list.eu) |
| **Brandfetch** | Brand logos and visual identity | [brandfetch.com](https://brandfetch.com) |
| **Wikidata** | Structured entity data (organization info, founding date, etc.) | [wikidata.org](https://www.wikidata.org) |
| **Green Web Foundation** | Green/sustainable hosting checks | [thegreenwebfoundation.org](https://www.thegreenwebfoundation.org) |
| **Website Carbon** | Estimated carbon footprint per page load | [websitecarbon.com](https://www.websitecarbon.com) |
| **Wayback Machine** | Historical snapshot availability via the Internet Archive | [web.archive.org](https://web.archive.org) |
| **HackerTarget** | Supplementary reconnaissance lookups | [hackertarget.com](https://hackertarget.com) |
| **Yahoo Finance** | Basic financial/ticker data for publicly traded companies | [finance.yahoo.com](https://finance.yahoo.com) |
| **ip-api.com** | IP geolocation (last-resort fallback in Fly proxy when MaxMind is unavailable; HTTP-only free tier) | [ip-api.com](https://ip-api.com) |
| **ipwho.is** | IP geolocation (HTTPS fallback, used by both Worker and Fly proxy) | [ipwho.is](https://ipwho.is) |
| **OpenRouter** | LLM inference proxy (powers AI-generated analysis) | [openrouter.ai](https://openrouter.ai) |
| **check-host.net** | Global HTTP availability probes from 20+ worldwide locations (relayed via Fly proxy) | [check-host.net](https://check-host.net) |
| **MaxMind GeoLite2** | Local IP geolocation database (city, country, ASN/ISP) used in Fly proxy | [maxmind.com](https://www.maxmind.com/en/geolite2/signup) |
| **CARTO** | Dark-themed map tile layer for IP geolocation maps | [carto.com](https://carto.com) |
| **OpenStreetMap** | Base map data underlying CARTO tiles | [openstreetmap.org](https://www.openstreetmap.org) |
| **Crunchbase** | Company and startup data enrichment | [crunchbase.com](https://www.crunchbase.com) |

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

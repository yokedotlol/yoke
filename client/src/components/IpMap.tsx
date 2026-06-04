import L from "leaflet";
import { MapPin } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AnalysisResult } from "../utils/types";
import { Panel } from "./Panel";

// Lazy-load Leaflet CSS on first mount (avoids ~15KB in critical CSS path)
let leafletCssLoaded = false;
function ensureLeafletCss() {
  if (leafletCssLoaded) return;
  leafletCssLoaded = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

/** Detect CDN/anycast generic coordinates and return zoom + center override */
function detectGenericLocation(lat: number, lon: number, city: string | undefined) {
  if (city) return null;

  // Null Island (0,0) — Cloudflare and other global CDNs return this
  if (Math.abs(lat) < 1 && Math.abs(lon) < 1) {
    return { zoom: 2, center: [20, 0] as [number, number], label: "Global CDN (anycast)" };
  }
  // US center (~37.75, ~-97.82) — used by geo-IP DBs as US fallback for anycast
  if (Math.abs(lat - 37.751) < 0.5 && Math.abs(lon + 97.822) < 0.5) {
    return { zoom: 3, center: [39.5, -98.35] as [number, number], label: "United States (approximate)" };
  }
  // UK center (~51.5, ~-0.13)
  if (Math.abs(lat - 51.5) < 0.5 && Math.abs(lon + 0.13) < 0.5) {
    return { zoom: 5, center: [54.5, -3.5] as [number, number], label: "United Kingdom (approximate)" };
  }
  // EU center (~50.1, ~8.7) — Frankfurt area
  if (Math.abs(lat - 50.1) < 1 && Math.abs(lon - 8.7) < 2) {
    return { zoom: 4, center: [50.0, 10.0] as [number, number], label: "Europe (approximate)" };
  }
  return null;
}

export function IpMap({ data }: { data: AnalysisResult }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  const lat = data.ip_info?.lat;
  const lon = data.ip_info?.lon;

  useEffect(() => {
    if (!mapRef.current || lat == null || lon == null) return;

    ensureLeafletCss();

    // Destroy previous map instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const city = data.ip_info?.city || undefined;
    const generic = detectGenericLocation(lat, lon, city);
    const center: [number, number] = generic ? generic.center : [lat, lon];
    const zoom = generic ? generic.zoom : 6;

    const map = L.map(mapRef.current, {
      center,
      zoom,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    if (generic) {
      // Dashed region circle for anycast
      L.circle(center, {
        radius: zoom <= 3 ? 1500000 : zoom <= 4 ? 800000 : 300000,
        fillColor: "#58a6ff",
        color: "#58a6ff",
        weight: 1,
        opacity: 0.3,
        fillOpacity: 0.06,
        dashArray: "8 6",
      }).addTo(map);

      // Anycast label overlay
      const labelDiv = L.DomUtil.create("div");
      labelDiv.style.cssText =
        "background:rgba(0,0,0,0.7);color:#94a3b8;font-family:var(--font-mono,monospace);font-size:11px;padding:4px 10px;border-radius:4px;pointer-events:none;white-space:nowrap;";
      labelDiv.textContent = "Anycast / distributed routing \u2014 approximate region";

      const LabelControl = L.Control.extend({
        onAdd: () => labelDiv,
      });
      new LabelControl({ position: "bottomleft" }).addTo(map);
    } else {
      // Precise city-level marker
      L.circleMarker([lat, lon], {
        radius: 8,
        fillColor: "#58a6ff",
        color: "#58a6ff",
        weight: 2,
        opacity: 0.8,
        fillOpacity: 0.3,
      })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:monospace;font-size:12px;color:#333">
          <strong>${data.ip_info?.ip ?? ""}</strong><br/>
          ${data.ip_info?.city ?? ""}, ${data.ip_info?.country ?? ""}<br/>
          ${data.ip_info?.isp ?? ""}
        </div>`,
        );

      L.circleMarker([lat, lon], {
        radius: 16,
        fillColor: "#58a6ff",
        color: "#58a6ff",
        weight: 1,
        opacity: 0.3,
        fillOpacity: 0.05,
      }).addTo(map);
    }

    mapInstanceRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [lat, lon, data.ip_info?.ip, data.ip_info?.city, data.ip_info?.country, data.ip_info?.isp]);

  if (lat == null || lon == null) return null;

  const city = data.ip_info?.city || undefined;
  const generic = detectGenericLocation(lat, lon, city);

  return (
    <Panel title="IP Geolocation Map" icon={<MapPin size={14} />}>
      <div className="p-3">
        <div
          ref={mapRef}
          role="img"
          aria-label={`Server location map: ${lat.toFixed(4)}, ${lon.toFixed(4)}${data.ip_info?.city ? `, ${data.ip_info.city}` : ""}${data.ip_info?.country ? `, ${data.ip_info.country}` : ""}`}
          tabIndex={-1}
          style={{ height: "320px", borderRadius: "var(--radius-sm)", overflow: "hidden" }}
        />
        <div className="flex items-center gap-3 mt-2 px-1">
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--dim)" }}>
            {lat.toFixed(4)}, {lon.toFixed(4)}
          </span>
          {generic ? (
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "11px",
                color: "var(--text-secondary)",
                fontStyle: "italic",
              }}
            >
              {generic.label} &mdash; CDN / anycast IP
            </span>
          ) : data.ip_info?.city ? (
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "11px", color: "var(--text-secondary)" }}>
              {data.ip_info.city}, {data.ip_info.country}
            </span>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

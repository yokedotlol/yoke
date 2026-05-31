import { registry } from "@worker/checks/registry";
import { describe, expect, it } from "vitest";

// ─── Registry Integrity Tests ─────────────────────────────────────────
// These tests ensure the Phase 2 check registry maintains its contract:
// correct order, unique keys, and required properties.

describe("Phase 2 Check Registry", () => {
  /**
   * The canonical key order must match the original hardcoded order in core.ts.
   * If you add a new check, append it to the end of both this list and the registry.
   * If you reorder, update both places and verify nothing breaks.
   */
  const EXPECTED_KEYS = [
    "rdap",
    "_robots_sitemap",
    "ip_info",
    "blocklists",
    "ssl",
    "performance",
    "performance_desktop",
    "crux",
    "_status",
    "llms_txt",
    "wayback",
    "tranco_rank",
    "email_auth",
    "carbon",
    "shodan",
    "dnssec",
    "breaches",
    "cert_transparency",
    "security_txt",
    "green_hosting",
    "well_known",
    "greynoise",
    "ans",
    "dns_propagation",
    "ripe_routing",
    "outage_links",
    "connection_timing",
    "social_accounts",
  ];

  it("should contain exactly the expected checks in the correct order", () => {
    const actualKeys = registry.map((check) => check.key);
    expect(actualKeys).toEqual(EXPECTED_KEYS);
  });

  it("should have unique keys", () => {
    const keys = registry.map((check) => check.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("should have non-empty labels for all checks", () => {
    for (const check of registry) {
      expect(check.label, `Check "${check.key}" has empty label`).toBeTruthy();
      expect(typeof check.label).toBe("string");
    }
  });

  it("should have a run function for all checks", () => {
    for (const check of registry) {
      expect(typeof check.run, `Check "${check.key}" missing run function`).toBe("function");
    }
  });

  it("should have 28 checks (Phase 2 total)", () => {
    expect(registry.length).toBe(28);
  });

  it("should have a default value defined for every check", () => {
    for (const check of registry) {
      // default can be null, [], {}, etc. — just verify the property exists
      expect(check, `Check "${check.key}" missing default property`).toHaveProperty("default");
    }
  });
});

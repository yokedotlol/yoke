export async function getRecentLookups(kv: KVNamespace, limit: number = 8) {
  const safeLimit = Math.min(Math.max(1, limit), 8);

  try {
    const raw = await kv.get("recent:index", "text");
    if (!raw) return { lookups: [] };
    const entries = JSON.parse(raw) as Array<{
      domain: string;
      analyzed_at: string;
      is_up: boolean | null;
      ssl_grade: string | null;
      score: number | null;
      tier: string | null;
      // Legacy field from cached entries written before tier migration
      grade?: string | null;
      archetype: string | null;
    }>;

    // Deduplicate by domain, keep most recent
    const seen = new Set<string>();
    const lookups: Array<{
      domain: string;
      analyzed_at: string;
      is_up: boolean | null;
      ssl_grade: string | null;
      score: number | null;
      tier: string | null;
      archetype: string | null;
    }> = [];
    for (const entry of entries) {
      if (seen.has(entry.domain)) continue;
      seen.add(entry.domain);
      lookups.push({
        domain: entry.domain,
        analyzed_at: entry.analyzed_at,
        is_up: entry.is_up,
        ssl_grade: entry.ssl_grade,
        score: entry.score,
        tier: entry.tier ?? entry.grade ?? null,
        archetype: entry.archetype,
      });
      if (lookups.length >= safeLimit) break;
    }

    return { lookups };
  } catch {
    return { lookups: [] };
  }
}

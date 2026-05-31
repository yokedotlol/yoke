// ─── Domain Comparison Endpoint ───────────────────────────────────────
// Accepts two domains, runs analysis on both (using cache when fresh),
// and returns comparison data with delta highlights.

import { CORS_HEADERS, type Env, normalizeDomain } from "../helpers";
import { analyzeDomain } from "./analyze";

interface CompareRequest {
  domain1?: string;
  domain2?: string;
}

interface AxisDelta {
  axis: string;
  score1: number;
  score2: number;
  delta: number;
  absDelta: number;
}

export async function compareDomains(body: CompareRequest, env: Env): Promise<Response> {
  if (!body.domain1 || !body.domain2) {
    return new Response(JSON.stringify({ error: "domain1 and domain2 are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const d1 = normalizeDomain(body.domain1);
  const d2 = normalizeDomain(body.domain2);

  if (!d1?.includes(".") || !d2?.includes(".")) {
    return new Response(JSON.stringify({ error: "Invalid domain format" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  if (d1 === d2) {
    return new Response(JSON.stringify({ error: "Cannot compare a domain with itself" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Run both analyses in parallel — analyzeDomain returns a Response,
  // so we need to extract JSON from each
  const [resp1, resp2] = await Promise.all([analyzeDomain(d1, env), analyzeDomain(d2, env)]);

  const [data1, data2] = await Promise.all([
    resp1.json() as Promise<Record<string, unknown>>,
    resp2.json() as Promise<Record<string, unknown>>,
  ]);

  // Build comparison summary
  const score1 = data1.domain_score as {
    composite: number;
    tier: string;
    axes: Record<string, { score: number; weight: number }>;
    archetype: { detected: string; confidence: number };
  } | null;
  const score2 = data2.domain_score as {
    composite: number;
    tier: string;
    axes: Record<string, { score: number; weight: number }>;
    archetype: { detected: string; confidence: number };
  } | null;

  const axes = ["security", "speed", "foundations", "reputation", "discoverability", "email"];
  const deltas: AxisDelta[] = axes.map((axis) => {
    const s1 = score1?.axes?.[axis]?.score ?? 0;
    const s2 = score2?.axes?.[axis]?.score ?? 0;
    return {
      axis,
      score1: s1,
      score2: s2,
      delta: s1 - s2,
      absDelta: Math.abs(s1 - s2),
    };
  });

  // Sort by biggest difference
  const biggestDifferences = [...deltas].sort((a, b) => b.absDelta - a.absDelta);

  const result = {
    domain1: data1,
    domain2: data2,
    comparison: {
      composite: {
        score1: score1?.composite ?? null,
        score2: score2?.composite ?? null,
        tier1: score1?.tier ?? null,
        tier2: score2?.tier ?? null,
        delta: (score1?.composite ?? 0) - (score2?.composite ?? 0),
      },
      archetype1: score1?.archetype?.detected ?? null,
      archetype2: score2?.archetype?.detected ?? null,
      axes: deltas,
      biggest_differences: biggestDifferences.slice(0, 3),
    },
  };

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

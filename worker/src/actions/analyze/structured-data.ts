// ─── Structured Data Validation ──────────────────────────────────────
// Validates JSON-LD structured data against schema.org field requirements.
// Uses the raw parsed objects already extracted by extractJsonLd.

import type { JsonLdItem } from "./types";

// ─── Types ───────────────────────────────────────────────────────────

export interface FieldValidation {
  field: string;
  status: "present" | "missing" | "recommended";
  value?: string;
}

export interface SchemaValidation {
  type: string;
  name: string | null;
  status: "complete" | "partial" | "missing_required";
  required_fields: FieldValidation[];
  recommended_fields: FieldValidation[];
  extra_fields: string[];
}

export interface StructuredDataResult {
  types_found: string[];
  total_items: number;
  validations: SchemaValidation[];
  has_issues: boolean;
}

// ─── Schema Definitions ──────────────────────────────────────────────
// Required and recommended fields per schema.org type

interface SchemaSpec {
  required: string[];
  recommended: string[];
}

const SCHEMA_SPECS: Record<string, SchemaSpec> = {
  Organization: {
    required: ["name", "url"],
    recommended: ["logo", "description", "sameAs", "contactPoint", "address", "telephone", "email", "foundingDate"],
  },
  Corporation: {
    required: ["name", "url"],
    recommended: ["logo", "description", "sameAs", "contactPoint", "address", "tickerSymbol", "foundingDate"],
  },
  LocalBusiness: {
    required: ["name", "address"],
    recommended: ["telephone", "openingHours", "geo", "url", "priceRange", "image", "description", "sameAs"],
  },
  Product: {
    required: ["name"],
    // schema.org 9.0 (Jul 2026) added size + pattern to Product
    // schema.org 30.1 (2026-09-16) added EU DPP + retail-feed vocabulary
    recommended: [
      "description",
      "image",
      "offers",
      "brand",
      "sku",
      "review",
      "aggregateRating",
      "category",
      "size",
      "pattern",
      "hasDigitalProductPassport",
      "authorizedRepresentative",
      "importer",
      "recycledContentPercentage",
      "substanceOfConcern",
      "consumerNotice",
      "isOftenBoughtWith",
      "specification",
    ],
  },
  Article: {
    required: ["headline", "author", "datePublished"],
    recommended: ["image", "dateModified", "publisher", "description", "mainEntityOfPage", "wordCount"],
  },
  NewsArticle: {
    required: ["headline", "author", "datePublished"],
    recommended: ["image", "dateModified", "publisher", "description", "dateline", "articleSection"],
  },
  BlogPosting: {
    required: ["headline", "author", "datePublished"],
    recommended: ["image", "dateModified", "publisher", "description", "mainEntityOfPage", "wordCount"],
  },
  WebSite: {
    required: ["name", "url"],
    recommended: ["description", "potentialAction", "publisher", "inLanguage"],
  },
  WebPage: {
    required: ["name"],
    recommended: ["url", "description", "datePublished", "dateModified", "breadcrumb", "mainEntity"],
  },
  BreadcrumbList: {
    required: ["itemListElement"],
    recommended: [],
  },
  FAQPage: {
    required: ["mainEntity"],
    recommended: ["name", "description"],
  },
  HowTo: {
    required: ["name", "step"],
    recommended: ["description", "image", "totalTime", "estimatedCost", "tool", "supply"],
  },
  Event: {
    required: ["name", "startDate", "location"],
    recommended: ["description", "endDate", "image", "offers", "performer", "organizer", "eventStatus"],
  },
  Person: {
    required: ["name"],
    recommended: ["url", "image", "jobTitle", "sameAs", "worksFor", "description"],
  },
  Recipe: {
    required: ["name"],
    recommended: [
      "image",
      "description",
      "recipeIngredient",
      "recipeInstructions",
      "cookTime",
      "prepTime",
      "nutrition",
      "recipeYield",
    ],
  },
  VideoObject: {
    required: ["name", "description", "thumbnailUrl", "uploadDate"],
    recommended: ["contentUrl", "duration", "embedUrl", "publisher"],
  },
  ImageObject: {
    required: ["contentUrl"],
    recommended: ["name", "description", "author", "datePublished", "caption"],
  },
  Review: {
    required: ["itemReviewed", "author"],
    recommended: ["reviewRating", "reviewBody", "datePublished"],
  },
  SoftwareApplication: {
    required: ["name"],
    recommended: ["operatingSystem", "applicationCategory", "offers", "aggregateRating", "description", "screenshot"],
  },
  Course: {
    required: ["name", "description"],
    recommended: ["provider", "offers", "courseCode", "hasCourseInstance"],
  },
  JobPosting: {
    required: ["title", "description", "datePosted", "hiringOrganization"],
    recommended: ["validThrough", "employmentType", "jobLocation", "baseSalary", "applicantLocationRequirements"],
  },
  // schema.org 9.0 (Jul 2026) new types
  Quiz: {
    required: ["name"],
    recommended: ["description", "about", "assesses", "educationalLevel", "hasPart"],
  },
  BoatTerminal: {
    required: ["name"],
    recommended: ["address", "geo", "url", "telephone", "description"],
  },
  BoatReservation: {
    required: ["name"],
    recommended: ["underName", "reservationStatus", "bookingTime", "provider"],
  },
  BoatTrip: {
    required: ["name"],
    recommended: ["departureBoatTerminal", "arrivalBoatTerminal", "provider", "itinerary", "description"],
  },
  // schema.org 30.1 (2026-09-16) EU Digital Product Passport vocabulary
  DigitalProductPassport: {
    required: [],
    recommended: ["name", "description", "url", "identifier"],
  },
  EnvironmentalProductDeclaration: {
    required: [],
    recommended: ["name", "description", "url", "certificationStatus", "issuedBy", "validThrough"],
  },
  DeclarationOfConformity: {
    required: [],
    recommended: ["name", "description", "url", "certificationStatus", "issuedBy", "validThrough"],
  },
};

// ─── Validation Logic ────────────────────────────────────────────────

function getFieldValue(raw: Record<string, unknown>, field: string): unknown {
  return raw[field];
}

function hasField(raw: Record<string, unknown>, field: string): boolean {
  const val = getFieldValue(raw, field);
  if (val === null || val === undefined) return false;
  if (typeof val === "string" && val.trim() === "") return false;
  if (Array.isArray(val) && val.length === 0) return false;
  return true;
}

function fieldPreview(val: unknown): string | undefined {
  if (typeof val === "string") return val.length > 80 ? `${val.slice(0, 80)}…` : val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return `[${val.length} items]`;
  if (typeof val === "object" && val !== null) return "{…}";
  return undefined;
}

function validateItem(item: JsonLdItem): SchemaValidation {
  const type = item.type;
  const raw = item.raw;
  const spec = SCHEMA_SPECS[type];

  if (!spec) {
    // Unknown type — just list what fields exist
    const fields = Object.keys(raw).filter((k) => !k.startsWith("@"));
    return {
      type,
      name: item.name,
      status: "complete", // no spec to violate
      required_fields: [],
      recommended_fields: [],
      extra_fields: fields,
    };
  }

  const requiredFields: FieldValidation[] = spec.required.map((field) => ({
    field,
    status: hasField(raw, field) ? "present" : "missing",
    value: hasField(raw, field) ? fieldPreview(getFieldValue(raw, field)) : undefined,
  }));

  const recommendedFields: FieldValidation[] = spec.recommended.map((field) => ({
    field,
    status: hasField(raw, field) ? "present" : "recommended",
    value: hasField(raw, field) ? fieldPreview(getFieldValue(raw, field)) : undefined,
  }));

  const knownFields = new Set([...spec.required, ...spec.recommended, "@context", "@type", "@id", "@graph"]);
  const extra = Object.keys(raw).filter((k) => !knownFields.has(k));

  const missingRequired = requiredFields.filter((f) => f.status === "missing").length;
  const status: SchemaValidation["status"] =
    missingRequired === 0 ? "complete" : missingRequired < spec.required.length ? "partial" : "missing_required";

  return {
    type,
    name: item.name,
    status,
    required_fields: requiredFields,
    recommended_fields: recommendedFields,
    extra_fields: extra,
  };
}

// ─── Main Export ─────────────────────────────────────────────────────

export function validateStructuredData(jsonLdItems: JsonLdItem[]): StructuredDataResult {
  if (!jsonLdItems || jsonLdItems.length === 0) {
    return { types_found: [], total_items: 0, validations: [], has_issues: false };
  }

  const validations = jsonLdItems.map(validateItem);
  const typesFound = [...new Set(validations.map((v) => v.type))];
  const hasIssues = validations.some((v) => v.status !== "complete");

  return {
    types_found: typesFound,
    total_items: jsonLdItems.length,
    validations,
    has_issues: hasIssues,
  };
}

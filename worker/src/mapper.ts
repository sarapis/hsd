/**
 * Airtable → HSDS field mapper.
 *
 * Ports transform/mapper.py to TypeScript.
 * Pure functions that transform raw JSON data objects into typed HSDS shapes.
 */
import type {
  Phone, Address, Language, Accessibility, Schedule, Contact,
  ServiceArea, Program, Funding, CostOption, RequiredDocument,
  Taxonomy, TaxonomyTerm, Location, OrganizationSummary, Organization,
  ServiceAtLocation, ServiceSummary, Service, Page,
} from "./types";

// ============================================================================
// Utility helpers
// ============================================================================

export function safeFloat(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isNaN(n) ? undefined : n;
  }
  if (typeof value === "number") return value;
  return undefined;
}

export function safeInt(value: unknown): number | undefined {
  if (value == null) return undefined;
  // Number("") and Number("  ") are 0, so an empty Airtable cell used to publish
  // `minimum_age: 0` / `year_incorporated: 0` rather than omitting the field —
  // semantically different, and inconsistent with safeFloat, which strips them.
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

export function firstOrNone<T>(list: T[] | undefined | null): T | undefined {
  return list && list.length > 0 ? list[0] : undefined;
}

export function joinList(list: unknown[] | undefined | null): string | undefined {
  if (!list || list.length === 0) return undefined;
  return list.map(String).join(", ");
}

/**
 * A single address: local part, one @, domain with at least one dot, and no
 * whitespace or commas. Deliberately stricter than RFC 5322 — the goal is to
 * keep malformed Airtable cells out of HSDS output, not to accept every
 * technically-legal address.
 */
const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@,;:<>()[\]\\]+\.[a-z]{2,}$/i;

/**
 * Return the value only if it is a single valid email address.
 *
 * Airtable data sometimes stores URLs in email fields. The check used to be
 * `includes("@")` despite a comment claiming "exactly one '@'", so
 * "a@b.org, c@d.org" and "mailto:x@y.org" both passed straight through into
 * HSDS output.
 */
export function sanitiseEmail(value: unknown): string | undefined {
  if (!value) return undefined;
  const s = String(value).trim();
  return EMAIL_RE.test(s) ? s : undefined;
}

/** Schemes allowed to pass through to an href. */
const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;

/** Any explicit "scheme:" prefix, safe or not. */
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Ensure a URL value has a valid scheme prefix.
 * Bare "www.example.com" fails the HSDS-UK 'uri' format check.
 *
 * Values reach an <a href> in the frontend, and React does not strip dangerous
 * schemes — it only warns in development. A dotless value used to be returned
 * verbatim, so `javascript:alert(1)` in an Airtable url field survived intact
 * all the way to a clickable link. Anything carrying a scheme outside the
 * allowlist is now dropped.
 */
export function normaliseUrl(value: unknown): string | undefined {
  if (!value) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (SAFE_SCHEME.test(s)) return s;
  if (ANY_SCHEME.test(s)) return undefined;
  // Add https:// to bare domain or www URLs
  if (s.startsWith("www.") || s.includes(".")) return `https://${s}`;
  return undefined;
}


export function normaliseStatus(status: unknown): string {
  if (!status) return "active";
  const s = String(status).toLowerCase().trim();
  if (s === "published" || s === "active") return "active";
  if (s === "inactive" || s === "unpublished" || s === "draft") return "inactive";
  if (s === "defunct" || s === "closed" || s === "removed") return "defunct";
  if (s === "temporarily closed" || s === "temp closed") return "temporarily closed";
  return "active"; // safe default
}

/**
 * Map an Airtable record id to a stable uuid-shaped string.
 *
 * NOT UUID v5, despite what this file used to claim: it is an XOR-fold of the
 * id's bytes with the version and variant nibbles overwritten, so ids differing
 * only in the bits those nibbles occupy collide, and the output near-plaintext
 * embeds its input (toUuid("org-1") begins 6a72672d-3100, ASCII "jrg-1").
 *
 * It is kept anyway, deliberately: every id this API has ever published derives
 * from it, so changing the algorithm would break every service and organization
 * URL and every stored reference at once. A correct SHA-1 v5 implementation sat
 * unused beside this one and has been deleted rather than left as a trap. The
 * UNIQUE index on each uuid column makes any real collision fail loudly at sync
 * time instead of silently resolving a lookup to the wrong record.
 *
 * Replacing it is a versioned-migration decision, not a refactor.
 */
export function toUuid(id: string): string {
  if (!id) return "00000000-0000-0000-0000-000000000000";

  // Pass through existing UUIDs unchanged
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id.toLowerCase();
  }

  // Simple deterministic hash: encode as bytes, pad/fold to 16 bytes
  const enc = new TextEncoder().encode(id);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < enc.length; i++) bytes[i % 16] ^= enc[i];
  // Seed first byte with length to avoid collisions between same-suffix IDs
  bytes[0] ^= enc.length & 0xff;

  // Set version 5 and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}


/**
 * Convert an optional reference id to a uuid, or omit the field entirely.
 *
 * Callers used to write `toUuid(x ?? "") || undefined`, but `toUuid("")` returns
 * the nil uuid — a truthy string — so the `|| undefined` never fired and records
 * with no parent published `parent_id: "00000000-0000-0000-0000-000000000000"`
 * instead of omitting the field. HSDS wants absent optional fields absent.
 */
export function toUuidOrUndefined(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return toUuid(id);
}

/**
 * Remove undefined/null values from an object (ORUK compliance —
 * optional fields without values should be omitted).
 */
export function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

// ============================================================================
// Map functions — each mirrors a Python map_* method
// ============================================================================

export function mapPhone(data: Record<string, unknown>): Phone {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    number: (data.number as string) || "",
    extension: data.extension as string | undefined,
    type: data.type as string | undefined,
    description: data.description as string | undefined,
  }) as Phone;
}

export function mapAddress(data: Record<string, unknown>): Address {
  let addressType = data.address_type;
  if (Array.isArray(addressType)) addressType = firstOrNone(addressType);

  return stripNulls({
    id: toUuid((data.id as string) || ""),
    address_1: data.address_1 as string | undefined,
    address_2: data.address_2 as string | undefined,
    city: data.city as string | undefined,
    state_province: data.state_province as string | undefined,
    postal_code: data.postal_code as string | undefined,
    region: data.region as string | undefined,
    country: data.country as string | undefined,
    address_type: addressType as string | undefined,
    attention: data.attention as string | undefined,
  }) as Address;
}

export function mapLanguage(data: Record<string, unknown>): Language {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    name: data.name as string | undefined,
    code: data.code as string | undefined,
    note: data.note as string | undefined,
  }) as Language;
}

export function mapAccessibility(data: Record<string, unknown>): Accessibility {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    description: data.description as string | undefined,
    details: data.details as string | undefined,
    url: normaliseUrl(data.url),
  }) as Accessibility;
}

export function mapSchedule(data: Record<string, unknown>): Schedule {
  let byday = data.byday;
  if (Array.isArray(byday)) byday = byday.join(",");

  return stripNulls({
    id: toUuid((data.id as string) || ""),
    valid_from: data.valid_from as string | undefined,
    valid_to: data.valid_to as string | undefined,
    dtstart: data.dtstart as string | undefined,
    timezone: data.timezone as string | undefined,
    until: data.until as string | undefined,
    count: data.count as string | undefined,
    wkst: data.wkst as string | undefined,
    freq: data.freq as string | undefined,
    interval: data.interval as string | undefined,
    byday: byday as string | undefined,
    byweekno: data.byweekno as string | undefined,
    bymonthday: data.bymonthday as string | undefined,
    byyearday: data.byyearday as string | undefined,
    description: data.description as string | undefined,
    opens_at: data.opens_at as string | undefined,
    closes_at: data.closes_at as string | undefined,
    schedule_link: data.schedule_link as string | undefined,
    attending_type: data.attending_type as string | undefined,
    notes: data.notes as string | undefined,
  }) as Schedule;
}

export function mapContact(
  data: Record<string, unknown>,
  phones?: Phone[],
): Contact {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    name: data.name as string | undefined,
    title: data.title as string | undefined,
    department: data.department as string | undefined,
    email: sanitiseEmail(data.email),
    phones: phones && phones.length > 0 ? phones : undefined,
  }) as Contact;
}

export function mapServiceArea(data: Record<string, unknown>): ServiceArea {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    name: data.name as string | undefined,
    description: data.description as string | undefined,
    extent: data.extent as string | undefined,
    extent_type: data.extent_type as string | undefined,
    uri: data.uri as string | undefined,
  }) as ServiceArea;
}

export function mapProgram(data: Record<string, unknown>): Program {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    name: (data.name as string) || "",
    alternate_name: data.alternate_name as string | undefined,
    description: data.description as string | undefined,
  }) as Program;
}

export function mapFunding(data: Record<string, unknown>): Funding {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    source: data.source as string | undefined,
  }) as Funding;
}

export function mapCostOption(data: Record<string, unknown>): CostOption {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    option: data.option as string | undefined,
    currency: data.currency as string | undefined,
    amount: safeFloat(data.amount),
    amount_description: data.amount_description as string | undefined,
    valid_from: data.valid_from as string | undefined,
    valid_to: data.valid_to as string | undefined,
  }) as CostOption;
}

export function mapRequiredDocument(data: Record<string, unknown>): RequiredDocument {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    document: data.document as string | undefined,
    uri: data.uri as string | undefined,
  }) as RequiredDocument;
}

export function mapTaxonomy(data: Record<string, unknown>): Taxonomy {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    name: (data.name as string) || "",
    description: (data.description as string) || "",
    uri: data.uri as string | undefined,
    version: data.version as string | undefined,
  }) as Taxonomy;
}

export function mapTaxonomyTerm(
  data: Record<string, unknown>,
  taxonomy?: Taxonomy,
): TaxonomyTerm {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    name: (data.name as string) || "",
    code: data.code as string | undefined,
    description: (data.description as string) || "",
    parent_id: toUuidOrUndefined(firstOrNone(data.parent as string[] | undefined)),
    taxonomy: toUuidOrUndefined(firstOrNone(data.taxonomy as string[] | undefined)),
    taxonomy_detail: taxonomy,
    language: data.language as string | undefined,
    term_uri: data.term_uri as string | undefined,
  }) as TaxonomyTerm;
}

export function mapLocation(
  data: Record<string, unknown>,
  opts?: {
    addresses?: Address[];
    phones?: Phone[];
    contacts?: Contact[];
    accessibility?: Accessibility[];
    languages?: Language[];
    schedules?: Schedule[];
  },
): Location {
  let locationType = data.location_type;
  if (Array.isArray(locationType)) locationType = firstOrNone(locationType);

  return stripNulls({
    id: toUuid((data.id as string) || ""),
    location_type: locationType as string | undefined,
    url: normaliseUrl(data.url),
    name: data.name as string | undefined,
    alternate_name: data.alternate_name as string | undefined,
    description: data.description as string | undefined,
    transportation: data.transportation as string | undefined,
    latitude: safeFloat(data.latitude),
    longitude: safeFloat(data.longitude),
    external_identifier: data.external_identifier as string | undefined,
    external_identifier_type: data.external_identifier_type as string | undefined,
    addresses: opts?.addresses && opts.addresses.length > 0 ? opts.addresses : undefined,
    phones: opts?.phones && opts.phones.length > 0 ? opts.phones : undefined,
    contacts: opts?.contacts && opts.contacts.length > 0 ? opts.contacts : undefined,
    accessibility: opts?.accessibility && opts.accessibility.length > 0 ? opts.accessibility : undefined,
    languages: opts?.languages && opts.languages.length > 0 ? opts.languages : undefined,
    schedules: opts?.schedules && opts.schedules.length > 0 ? opts.schedules : undefined,
  }) as Location;
}

export function mapOrganizationSummary(data: Record<string, unknown>): OrganizationSummary {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    name: (data.name as string) || "",
    alternate_name: data.alternate_name as string | undefined,
    description: data.description as string | undefined,
    email: sanitiseEmail(data.email),
    website: normaliseUrl(data.website),
    logo: normaliseUrl(data.logo),
    uri: data.uri as string | undefined,
  }) as OrganizationSummary;
}

export function mapOrganization(
  data: Record<string, unknown>,
  opts?: {
    phones?: Phone[];
    contacts?: Contact[];
    locations?: Location[];
    programs?: Program[];
    funding?: Funding[];
  },
): Organization {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    name: (data.name as string) || "",
    alternate_name: data.alternate_name as string | undefined,
    description: data.description as string | undefined,
    email: sanitiseEmail(data.email),
    website: normaliseUrl(data.website),
    year_incorporated: safeInt(data.year_incorporated),
    legal_status: data.legal_status as string | undefined,
    logo: normaliseUrl(data.logo),
    uri: data.uri as string | undefined,
    parent_organization_id: toUuidOrUndefined(firstOrNone(data.organization as string[] | undefined)),
    phones: opts?.phones && opts.phones.length > 0 ? opts.phones : undefined,
    contacts: opts?.contacts && opts.contacts.length > 0 ? opts.contacts : undefined,
    locations: opts?.locations && opts.locations.length > 0 ? opts.locations : undefined,
    programs: opts?.programs && opts.programs.length > 0 ? opts.programs : undefined,
    funding: opts?.funding && opts.funding.length > 0 ? opts.funding : undefined,
  }) as Organization;
}

export function mapServiceAtLocation(
  data: Record<string, unknown>,
  opts?: {
    location?: Location;
    phones?: Phone[];
    contacts?: Contact[];
    schedules?: Schedule[];
    service_areas?: ServiceArea[];
  },
): ServiceAtLocation {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    service_id: toUuidOrUndefined(firstOrNone(data.services as string[] | undefined)),
    description: data.description as string | undefined,
    location: opts?.location,
    phones: opts?.phones && opts.phones.length > 0 ? opts.phones : undefined,
    contacts: opts?.contacts && opts.contacts.length > 0 ? opts.contacts : undefined,
    schedules: opts?.schedules && opts.schedules.length > 0 ? opts.schedules : undefined,
    service_areas: opts?.service_areas && opts.service_areas.length > 0 ? opts.service_areas : undefined,
  }) as ServiceAtLocation;
}

export function mapServiceSummary(
  data: Record<string, unknown>,
  organizationId: string,
  organization?: OrganizationSummary,
): ServiceSummary {
  return stripNulls({
    id: toUuid((data.id as string) || ""),
    organization_id: toUuid(organizationId),
    name: (data.name as string) || "",
    status: normaliseStatus(data.status),
    alternate_name: data.alternate_name as string | undefined,
    description: data.description as string | undefined,
    url: normaliseUrl(data.url),
    email: sanitiseEmail(data.email),
    last_modified: data.lastUpdated as string | undefined,
    organization,
    need_focus: (data.needFocus as string[]) || [],
    community_focus: (data.communityFocus as string[]) || [],
  }) as ServiceSummary;
}

export function mapService(
  data: Record<string, unknown>,
  organizationId: string,
  opts?: {
    organization?: OrganizationSummary;
    program?: Program;
    phones?: Phone[];
    contacts?: Contact[];
    schedules?: Schedule[];
    service_areas?: ServiceArea[];
    service_at_locations?: ServiceAtLocation[];
    languages?: Language[];
    funding?: Funding[];
    cost_options?: CostOption[];
    required_documents?: RequiredDocument[];
  },
): Service {
  const groupNameList = data.groupName as string[] | undefined;
  const groupName = groupNameList && groupNameList.length > 0 ? groupNameList[0] : undefined;

  return stripNulls({
    id: toUuid((data.id as string) || ""),
    organization_id: toUuid(organizationId),
    name: (data.name as string) || "",
    status: normaliseStatus(data.status),
    alternate_name: data.alternate_name as string | undefined,
    description: data.description as string | undefined,
    url: normaliseUrl(data.url),
    email: sanitiseEmail(data.email),
    interpretation_services: data.interpretation_services as string | undefined,
    application_process: data.application_process as string | undefined,
    fees_description: data.fees_description as string | undefined,
    accreditations: data.accreditations as string | undefined,
    eligibility_description: data.eligibility_description as string | undefined,
    minimum_age: safeInt(data.minimum_age),
    maximum_age: safeInt(data.maximum_age),
    assured_date: data.assured_date as string | undefined,
    assurer_email: data.assurer_email as string | undefined,
    alert: data.alert as string | undefined,
    last_modified: data.lastUpdated as string | undefined,
    organization: opts?.organization,
    program: opts?.program,
    phones: opts?.phones && opts.phones.length > 0 ? opts.phones : undefined,
    contacts: opts?.contacts && opts.contacts.length > 0 ? opts.contacts : undefined,
    schedules: opts?.schedules && opts.schedules.length > 0 ? opts.schedules : undefined,
    service_areas: opts?.service_areas && opts.service_areas.length > 0 ? opts.service_areas : undefined,
    service_at_locations: opts?.service_at_locations && opts.service_at_locations.length > 0 ? opts.service_at_locations : undefined,
    languages: opts?.languages && opts.languages.length > 0 ? opts.languages : undefined,
    funding: opts?.funding && opts.funding.length > 0 ? opts.funding : undefined,
    cost_options: opts?.cost_options && opts.cost_options.length > 0 ? opts.cost_options : undefined,
    required_documents: opts?.required_documents && opts.required_documents.length > 0 ? opts.required_documents : undefined,
    group_name: groupName,
    need_focus: data.needFocus as string[] | undefined,
    community_focus: data.communityFocus as string[] | undefined,
  }) as Service;
}

// ============================================================================
// Pagination helper
// ============================================================================

/**
 * Create a paginated Page response from total count and current page items.
 */
export function paginate<T>(
  items: T[],
  totalItems: number,
  page: number,
  perPage: number,
): Page<T> {
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  return {
    total_items: totalItems,
    total_pages: totalPages,
    page_number: page,
    size: items.length,
    first_page: page === 1,
    last_page: page >= totalPages,
    empty: items.length === 0,
    contents: items,
  };
}

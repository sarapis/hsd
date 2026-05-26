/**
 * Typed Airtable record shapes.
 *
 * These interfaces describe the raw field structures as they come from Airtable,
 * BEFORE mapping to HSDS output types. Inspired by PR #15's `models/airtable.py`.
 *
 * Benefits:
 * - Catch field name mismatches at compile time (e.g. `needFocus` vs `need_focus`)
 * - Self-documenting: shows which fields are Airtable-linked arrays vs scalars
 * - Makes mapper functions type-safe instead of using `Record<string, unknown>`
 */

// ============================================================================
// Core table fields (as stored in Airtable)
// ============================================================================

/** Airtable "organizations" table fields. */
export interface AirtableOrganization {
  id: string;
  name: string;
  alternate_name?: string;
  description?: string;
  email?: string;
  website?: string;
  year_incorporated?: number;
  legal_status?: string;
  logo?: string;
  uri?: string;
  /** Linked record IDs → parent organization */
  organization?: string[];
  /** Linked record IDs → phones table */
  phones?: string[];
  /** Linked record IDs → contacts table */
  contacts?: string[];
  /** Linked record IDs → locations table */
  locations?: string[];
  /** Linked record IDs → programs table */
  programs?: string[];
  /** Linked record IDs → funding table */
  funding?: string[];
  /** Linked record IDs → organization_identifier table */
  organization_identifiers?: string[];
}

/** Airtable "services" table fields. */
export interface AirtableService {
  id: string;
  name: string;
  status?: string;
  alternate_name?: string;
  description?: string;
  url?: string;
  email?: string;
  interpretation_services?: string;
  application_process?: string;
  fees_description?: string;
  accreditations?: string;
  eligibility_description?: string;
  minimum_age?: number;
  maximum_age?: number;
  assured_date?: string;
  assurer_email?: string;
  alert?: string;
  lastUpdated?: string;
  /** Linked record IDs → organizations table */
  organizations?: string[];
  /** Linked record IDs → phones table */
  phones?: string[];
  /** Linked record IDs → contacts table */
  contacts?: string[];
  /** Linked record IDs → schedules table */
  schedules?: string[];
  /** Linked record IDs → service_areas table */
  service_areas?: string[];
  /** Linked record IDs → service_at_location table */
  service_at_locations?: string[];
  /** Linked record IDs → languages table */
  languages?: string[];
  /** Linked record IDs → funding table */
  funding?: string[];
  /** Linked record IDs → cost_option table */
  cost_options?: string[];
  /** Linked record IDs → required_document table */
  required_documents?: string[];
  /** Custom: organization/group name (lookup field) */
  groupName?: string[];
  /** Custom: need categories (multi-select/lookup) */
  needFocus?: string[];
  /** Custom: target communities (multi-select/lookup) */
  communityFocus?: string[];
}

/** Airtable "service_at_location" table fields. */
export interface AirtableServiceAtLocation {
  id: string;
  /** Linked record IDs → services table */
  services?: string[];
  description?: string;
  /** Linked record IDs → locations table */
  locations?: string[];
  /** Linked record IDs → phones table */
  phones?: string[];
  /** Linked record IDs → contacts table */
  contacts?: string[];
  /** Linked record IDs → schedules table */
  schedules?: string[];
}

/** Airtable "locations" table fields. */
export interface AirtableLocation {
  id: string;
  location_type?: string | string[];
  url?: string;
  name?: string;
  alternate_name?: string;
  description?: string;
  transportation?: string;
  latitude?: number | string;
  longitude?: number | string;
  external_identifier?: string;
  external_identifier_type?: string;
  /** Linked record IDs → addresses table */
  addresses?: string[];
  /** Linked record IDs → accessibility table */
  accessibility?: string[];
}

/** Airtable "addresses" table fields. */
export interface AirtableAddress {
  id: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  region?: string;
  country?: string;
  address_type?: string | string[];
  attention?: string;
}

/** Airtable "contacts" table fields. */
export interface AirtableContact {
  id: string;
  name?: string;
  title?: string;
  department?: string;
  email?: string;
}

/** Airtable "phones" table fields. */
export interface AirtablePhone {
  id: string;
  number: string;
  extension?: string;
  type?: string;
  description?: string;
}

/** Airtable "schedules" table fields. */
export interface AirtableSchedule {
  id: string;
  valid_from?: string;
  valid_to?: string;
  dtstart?: string;
  timezone?: string;
  until?: string;
  count?: string;
  wkst?: string;
  freq?: string;
  interval?: string;
  byday?: string | string[];
  byweekno?: string;
  bymonthday?: string;
  byyearday?: string;
  description?: string;
  opens_at?: string;
  closes_at?: string;
  schedule_link?: string;
  attending_type?: string;
  notes?: string;
}

/** Airtable "accessibility" table fields. */
export interface AirtableAccessibility {
  id: string;
  description?: string;
  details?: string;
  url?: string;
}

/** Airtable "languages" table fields. */
export interface AirtableLanguage {
  id: string;
  name?: string;
  code?: string;
  note?: string;
}

/** Airtable "taxonomies" table fields. */
export interface AirtableTaxonomy {
  id: string;
  name: string;
  description?: string;
  uri?: string;
  version?: string;
}

/** Airtable "taxonomy_terms" table fields. */
export interface AirtableTaxonomyTerm {
  id: string;
  name: string;
  code?: string;
  description?: string;
  /** Linked record IDs → parent taxonomy_term */
  parent?: string[];
  /** Linked record IDs → taxonomies table */
  taxonomy?: string[];
  language?: string;
  term_uri?: string;
  /** Custom: icon attachment (Airtable attachment array) */
  "x-icon_dark"?: AirtableAttachment[];
}

/** Airtable "programs" table fields. */
export interface AirtableProgram {
  id: string;
  name: string;
  alternate_name?: string;
  description?: string;
}

/** Airtable "service_areas" table fields. */
export interface AirtableServiceArea {
  id: string;
  name?: string;
  description?: string;
  extent?: string;
  extent_type?: string;
  uri?: string;
}

/** Airtable "funding" table fields. */
export interface AirtableFunding {
  id: string;
  source?: string;
}

/** Airtable "cost_option" table fields. */
export interface AirtableCostOption {
  id: string;
  option?: string;
  currency?: string;
  amount?: number | string;
  amount_description?: string;
  valid_from?: string;
  valid_to?: string;
}

/** Airtable "required_document" table fields. */
export interface AirtableRequiredDocument {
  id: string;
  document?: string;
  uri?: string;
}

// ============================================================================
// Airtable attachment type (used for icon fields)
// ============================================================================

/** Airtable attachment object (used in attachment-type fields). */
export interface AirtableAttachment {
  id: string;
  url: string;
  filename: string;
  size?: number;
  type?: string;
  width?: number;
  height?: number;
  thumbnails?: {
    small?: { url: string; width: number; height: number };
    large?: { url: string; width: number; height: number };
    full?: { url: string; width: number; height: number };
  };
}

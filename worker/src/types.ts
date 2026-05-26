/**
 * HSDS 3.0 TypeScript types.
 *
 * Ports the Pydantic models from models/hsds.py to TypeScript interfaces.
 * These are used by routes, mapper, and MCP tools.
 */

// ============================================================================
// Supporting Objects
// ============================================================================

export interface Phone {
  id: string;
  number: string;
  extension?: string;
  type?: string;
  description?: string;
}

export interface Address {
  id: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  region?: string;
  country?: string;
  address_type?: string;
  attention?: string;
}

export interface Language {
  id: string;
  name?: string;
  code?: string;
  note?: string;
}

export interface Accessibility {
  id: string;
  description?: string;
  details?: string;
  url?: string;
}

export interface Schedule {
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
  byday?: string;
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

export interface ServiceArea {
  id: string;
  name?: string;
  description?: string;
  extent?: string;
  extent_type?: string;
  uri?: string;
}

export interface Contact {
  id: string;
  name?: string;
  title?: string;
  department?: string;
  email?: string;
  phones?: Phone[];
}

export interface Funding {
  id: string;
  source?: string;
}

export interface RequiredDocument {
  id: string;
  document?: string;
  uri?: string;
}

export interface CostOption {
  id: string;
  option?: string;
  currency?: string;
  amount?: number;
  amount_description?: string;
  valid_from?: string;
  valid_to?: string;
}

export interface Program {
  id: string;
  name: string;
  alternate_name?: string;
  description?: string;
}

// ============================================================================
// Taxonomy Objects
// ============================================================================

export interface Taxonomy {
  id: string;
  name: string;
  description?: string;
  uri?: string;
  version?: string;
}

export interface TaxonomyTerm {
  id: string;
  name: string;
  code?: string;
  description?: string;
  parent_id?: string;
  taxonomy?: string;
  taxonomy_detail?: Taxonomy;
  language?: string;
  term_uri?: string;
}

// ============================================================================
// Core Objects
// ============================================================================

export interface Location {
  id: string;
  location_type?: string;
  url?: string;
  name?: string;
  alternate_name?: string;
  description?: string;
  transportation?: string;
  latitude?: number;
  longitude?: number;
  external_identifier?: string;
  external_identifier_type?: string;
  addresses?: Address[];
  phones?: Phone[];
  contacts?: Contact[];
  accessibility?: Accessibility[];
  languages?: Language[];
  schedules?: Schedule[];
}

export interface OrganizationSummary {
  id: string;
  name: string;
  alternate_name?: string;
  description?: string;
  email?: string;
  website?: string;
  logo?: string;
  uri?: string;
}

export interface Organization {
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
  parent_organization_id?: string;
  phones?: Phone[];
  contacts?: Contact[];
  locations?: Location[];
  programs?: Program[];
  funding?: Funding[];
}

export interface ServiceAtLocation {
  id: string;
  service_id?: string;
  description?: string;
  location?: Location;
  phones?: Phone[];
  contacts?: Contact[];
  schedules?: Schedule[];
  service_areas?: ServiceArea[];
}

export interface Service {
  id: string;
  organization_id: string;
  name: string;
  status: string;
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
  last_modified?: string;
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
  /** Custom extension: organization/group name from Airtable */
  group_name?: string;
  /** Custom extension: need categories */
  need_focus?: string[];
  /** Custom extension: target communities */
  community_focus?: string[];
}

export interface ServiceSummary {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  alternate_name?: string;
  description?: string;
  url?: string;
  email?: string;
  last_modified?: string;
  organization?: OrganizationSummary;
  program?: Program;
  need_focus?: string[];
  community_focus?: string[];
}

// ============================================================================
// Pagination
// ============================================================================

export interface Page<T = unknown> {
  total_items: number;
  total_pages: number;
  page_number: number;
  size: number;
  first_page: boolean;
  last_page: boolean;
  empty: boolean;
  contents: T[];
}

// ============================================================================
// API Root
// ============================================================================

export interface ApiInfo {
  version: string;
  profile: string;
  openapi_url: string;
}

// ============================================================================
// Map Types
// ============================================================================

export interface MapService {
  id: string;
  name: string;
  description?: string;
  address?: string;
  phone?: string;
  url?: string;
  needFocus: string[];
  communityFocus: string[];
  latitude?: number;
  longitude?: number;
  organization_name?: string;
}

export interface CategoryDetail {
  name: string;
  icon?: string;
}

export interface MapDataResponse {
  services: MapService[];
  needCategories: CategoryDetail[];
  communityCategories: CategoryDetail[];
}

export interface GeocodedLocation {
  id: string;
  name?: string;
  address?: string;
  latitude: number;
  longitude: number;
  service_id?: string;
  service_name?: string;
  organization_id?: string;
  organization_name?: string;
}

export interface GeocodedLocationsResponse {
  total: number;
  locations: GeocodedLocation[];
}

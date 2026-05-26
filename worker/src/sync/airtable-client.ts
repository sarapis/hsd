/**
 * Fetch-based Airtable API client.
 *
 * Ports airtable/client.py to Workers fetch API.
 * Handles pagination, rate limiting, and table ID mapping.
 */

const AIRTABLE_API_URL = "https://api.airtable.com/v0";

/** Rate limit: max 5 requests/second → 200ms between requests. */
const RATE_LIMIT_MS = 200;

/**
 * Table name → Airtable table ID mapping.
 * From airtable/client.py TABLE_IDS.
 */
const TABLE_IDS: Record<string, string> = {
  organizations: "tblSAotCxT28qpz5C",
  services: "tblUV34ri18xDgs64",
  locations: "tbljfrAgraVmN3k4C",
  addresses: "tblj0cRXNX6cUvXl4",
  contacts: "tblMUwgSsxSL0W248",
  phones: "tblkIMjWC53SogK0g",
  schedules: "tblB1KshhZl3Kw2vs",
  languages: "tblok7nshfDBjyygQ",
  accessibility: "tblH5JHr0byFcYgWH",
  service_at_location: "tbl6DuXeIQcMAf0lv",
  taxonomies: "tblA73lY0HxIRTgJn",
  taxonomy_terms: "tblTBQcmbYH3xJK75",
  programs: "tbllCNEooPY1hEcnp",
  service_areas: "tblzmk5213aL7eelv",
  funding: "tblk0lisFgbbzMJbl",
  cost_option: "tblw7TjA0R9MCETuT",
  required_document: "tblYlYs5qlwUafkor",
};

/**
 * Fetch all records from an Airtable table with pagination.
 * Returns array of { id, fields, lastModifiedTime }.
 */
export async function listRecords(
  apiKey: string,
  baseId: string,
  tableName: string,
  filterFormula?: string,
): Promise<Array<{ id: string; fields: Record<string, unknown>; lastModifiedTime?: string }>> {
  const tableId = TABLE_IDS[tableName];
  if (!tableId) {
    throw new Error(`Unknown Airtable table: ${tableName}`);
  }

  const records: Array<{ id: string; fields: Record<string, unknown>; lastModifiedTime?: string }> = [];
  let offset: string | undefined;

  while (true) {
    const url = new URL(`${AIRTABLE_API_URL}/${baseId}/${tableId}`);
    if (offset) url.searchParams.set("offset", offset);
    if (filterFormula) url.searchParams.set("filterByFormula", filterFormula);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("returnFieldsByFieldId", "false");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      records: Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }>;
      offset?: string;
    };

    // Map records, using createdTime as a proxy for lastModifiedTime
    // (Airtable REST API v0 returns createdTime; for true modifiedTime
    //  you'd need the "Last Modified" field added to the table)
    for (const r of data.records) {
      records.push({
        id: r.id,
        fields: r.fields,
        lastModifiedTime: r.createdTime,
      });
    }

    offset = data.offset;
    if (!offset) break;

    // Rate limit — 200ms delay between pages
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
  }

  return records;
}

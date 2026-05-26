/**
 * Root API endpoint.
 *
 * Returns HSDS API metadata as required by the specification.
 */
import { Hono } from "hono";
import type { Env } from "../env";

const root = new Hono<{ Bindings: Env }>();

root.get("/", (c) => {
  return c.json({
    version: "HSDS-UK-3.0",
    profile: "https://github.com/OpenReferralUK/uk-profile/blob/main/docs/index.md",
    openapi_url: "https://docs.openreferraluk.org/en/latest/openapi30.json",
  });
});

export { root };

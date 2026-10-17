import { describe, expect, it } from "vitest";
import { closestName } from "../src/suggest.js";

const NAMES = ["DATABASE_URL", "STRIPE_KEY", "REDIS_URL", "SENTRY_DSN"];

describe("closestName", () => {
  it("matches a name typed in the wrong case", () => {
    expect(closestName("database_url", NAMES)).toBe("DATABASE_URL");
  });

  it("prefers a name the query abbreviates over a closer edit", () => {
    // REDIS_URL is fewer edits from DB_URL, but DB_URL abbreviates DATABASE_URL.
    expect(closestName("DB_URL", NAMES)).toBe("DATABASE_URL");
  });

  it("catches small typos and truncations", () => {
    expect(closestName("DATABSE_URL", NAMES)).toBe("DATABASE_URL");
    expect(closestName("STRIPE", NAMES)).toBe("STRIPE_KEY");
  });

  it("suggests nothing when no name is plausibly meant", () => {
    expect(closestName("URL", NAMES)).toBeUndefined();
    expect(closestName("D", NAMES)).toBeUndefined();
    expect(closestName("API_TOKEN", NAMES)).toBeUndefined();
    expect(closestName("ANYTHING", [])).toBeUndefined();
  });
});

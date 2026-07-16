import { describe, expect, it } from "vitest";
import { buildAppUrl } from "../../src/client/AppUrl";

describe("buildAppUrl", () => {
  it("keeps root-hosted navigation at the domain root", () => {
    expect(buildAppUrl("", "/")).toBe("/");
    expect(buildAppUrl("?requeue", "/")).toBe("/?requeue");
  });

  it("keeps navigation inside a GitHub Pages repository base", () => {
    const base = "/OpenFront-WorldCover/";
    expect(buildAppUrl("", base)).toBe(base);
    expect(buildAppUrl("/#modal=store", base)).toBe(
      "/OpenFront-WorldCover/#modal=store",
    );
    expect(buildAppUrl("streamer-mode", base)).toBe(
      "/OpenFront-WorldCover/streamer-mode",
    );
  });
});

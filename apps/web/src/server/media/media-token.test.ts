import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueMediaToken,
  mediaTokenDenial,
  requestMediaToken,
  signMediaToken,
  verifyMediaToken,
} from "@/server/media/media-token";

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const HOUR_MS = 60 * 60 * 1000;

function mediaRequest(search: string): Request {
  return new Request(
    `http://localhost:3000/hls/dQw4w9WgXcQ/master.m3u8${search}`,
  );
}

describe("signMediaToken / verifyMediaToken", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-for-media-tokens"));
  afterEach(() => vi.unstubAllEnvs());

  it("mints <expiry>.<sig> with a 12 hour expiry", () => {
    const token = signMediaToken(NOW);
    const [expiry, sig] = token.split(".");
    expect(Number(expiry)).toBe(NOW / 1000 + 12 * 60 * 60);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("accepts its own token until it expires", () => {
    const token = signMediaToken(NOW);
    expect(verifyMediaToken(token, NOW)).toBe(true);
    expect(verifyMediaToken(token, NOW + 11 * HOUR_MS)).toBe(true);
    expect(verifyMediaToken(token, NOW + 12 * HOUR_MS)).toBe(false);
    expect(verifyMediaToken(token, NOW + 13 * HOUR_MS)).toBe(false);
  });

  it("refuses a tampered signature", () => {
    const token = signMediaToken(NOW);
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(verifyMediaToken(`${token.slice(0, -1)}${last}`, NOW)).toBe(false);
  });

  it("refuses an expiry pushed later under the old signature", () => {
    const [expiry, sig] = signMediaToken(NOW).split(".");
    const extended = `${Number(expiry) + 24 * 60 * 60}.${sig}`;
    expect(verifyMediaToken(extended, NOW)).toBe(false);
  });

  it("refuses a token signed with another AUTH_SECRET", () => {
    const token = signMediaToken(NOW);
    vi.stubEnv("AUTH_SECRET", "a-different-secret");
    expect(verifyMediaToken(token, NOW)).toBe(false);
  });

  it("refuses malformed values, googlevideo's own mt among them", () => {
    for (const bad of [
      null,
      "",
      "1727700000",
      "1727700000.",
      ".abc",
      "abc.def",
      `${NOW / 1000 + 60}.short`,
      `${NOW / 1000 + 60}.${"A".repeat(44)}`,
    ]) {
      expect(verifyMediaToken(bad, NOW)).toBe(false);
    }
  });

  it("verifies nothing without AUTH_SECRET", () => {
    const token = signMediaToken(NOW);
    vi.stubEnv("AUTH_SECRET", "");
    expect(verifyMediaToken(token, NOW)).toBe(false);
    expect(() => signMediaToken(NOW)).toThrow("AUTH_SECRET");
  });
});

describe("issueMediaToken", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-for-media-tokens"));
  afterEach(() => vi.unstubAllEnvs());

  it("mints nothing while MEDIA_TOKEN_REQUIRED is off, so URLs stay as they were", () => {
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", undefined);
    expect(issueMediaToken(NOW)).toBeNull();
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", "false");
    expect(issueMediaToken(NOW)).toBeNull();
  });

  it("mints a verifiable token once it is on", () => {
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", "true");
    const token = issueMediaToken(NOW);
    expect(token).not.toBeNull();
    expect(verifyMediaToken(token, NOW)).toBe(true);
  });

  it("mints nothing without AUTH_SECRET, so gated routes refuse rather than serve unchecked", () => {
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", "true");
    vi.stubEnv("AUTH_SECRET", "");
    expect(issueMediaToken(NOW)).toBeNull();
    expect(mediaTokenDenial(mediaRequest(""))?.status).toBe(403);
  });
});

describe("mediaTokenDenial", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-for-media-tokens"));
  afterEach(() => vi.unstubAllEnvs());

  it("lets everything through while MEDIA_TOKEN_REQUIRED is off", () => {
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", undefined);
    expect(mediaTokenDenial(mediaRequest(""))).toBeNull();
    expect(mediaTokenDenial(mediaRequest("?mt=garbage"))).toBeNull();
  });

  it("answers 403 without a valid token once it is on", () => {
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", "true");
    const expired = signMediaToken(Date.now() - 13 * HOUR_MS);
    for (const search of ["", "?mt=garbage", `?mt=${expired}`]) {
      const denied = mediaTokenDenial(mediaRequest(search));
      expect(denied?.status).toBe(403);
      expect(denied?.headers.get("cache-control")).toBe("no-store");
    }
    expect(
      mediaTokenDenial(mediaRequest(`?mt=${signMediaToken()}`)),
    ).toBeNull();
  });

  it("finds the token after googlevideo's own mt in a proxied query", () => {
    vi.stubEnv("MEDIA_TOKEN_REQUIRED", "true");
    const token = signMediaToken();
    const request = mediaRequest(`?itag=137&mt=1727700000&host=x&mt=${token}`);
    expect(mediaTokenDenial(request)).toBeNull();
    expect(requestMediaToken(request)).toBe(token);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { linkState } from "./links.ts";

test("reserved example hosts are placeholders", () => {
  for (const u of [
    "https://example.org/repo/02",
    "http://example.com",
    "https://docs.example.net/x",
    "https://app.test/",
    "https://thing.invalid",
    "https://demo.example",
  ])
    assert.equal(linkState(u), "placeholder", u);
});

test("real hosts are fine, look-alikes included", () => {
  for (const u of [
    "https://github.com/PrinceXDev/dogfood-judge",
    "https://notexample.org",
    "https://example.org.evil.com",
    "https://my-test.dev",
  ])
    assert.equal(linkState(u), "ok", u);
});

test("non-web schemes and junk never render as links", () => {
  for (const u of [
    "javascript:alert(1)",
    "ftp://example.com",
    "not a url",
    "",
    null,
  ])
    assert.equal(linkState(u), "invalid", String(u));
});

import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, parseSemver } from "../src/version.js";

test("parses semver with and without the v prefix", () => {
  assert.deepEqual(parseSemver("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseSemver("1.2.3"), [1, 2, 3]);
  assert.equal(parseSemver("dev"), null);
});

test("compares releases numerically, not lexically", () => {
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

test("an unparsable version never claims an update is available", () => {
  assert.equal(compareVersions("1.0.0", "dev"), 0);
  assert.equal(compareVersions("dev", "1.0.0"), 0);
});

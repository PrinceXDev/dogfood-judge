import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  auditReviews,
  type BundleReview,
  fromHex,
  goValues,
  inclusionProof,
  merkleRoot,
  reviewLeaf,
  toHex,
  verifyInclusion,
} from "./merkle.ts";

// The same tree as tests/merkle_vector_test.go: both sides assert these hashes.
const reviews: BundleReview[] = [
  {
    judge: "j_a1",
    project: "prj_01",
    values: { quality: 4, functionality: 2, innovation: 3 },
  },
  {
    judge: "j_b2",
    project: "prj_01",
    values: { quality: 5, functionality: 5, innovation: 1 },
  },
  {
    judge: "j_a1",
    project: "prj_02",
    values: { quality: 1, functionality: 3, innovation: 2 },
  },
  {
    judge: "j_c3",
    project: "prj_02",
    values: { quality: 3, functionality: 4, innovation: 4 },
  },
  { judge: "j_<&>", project: "prj_03", values: { "a<b": 2 } },
];
const ROOT = "781fefa156014ceac46a8ea361e30e1fa057ceb1236a7fa9ee5582a33936d291";

describe("merkle (matches src/core/merkle.go)", () => {
  test("values serialise like Go's encoding/json", () => {
    assert.equal(
      goValues({ quality: 4, functionality: 2 }),
      '{"functionality":2,"quality":4}',
    );
    const bs = String.fromCharCode(92); // Go writes < as backslash-u003c
    assert.equal(goValues({ "a<b": 2 }), `{"a${bs}u003cb":2}`);
  });

  test("leaves and root equal the Go vector", async () => {
    assert.equal(
      await reviewLeaf(reviews[0]),
      "bf1bb045b450be6db45078a57729ca704734101bb26752e3f0be9167d2fd2d6f",
    );
    assert.equal(
      await reviewLeaf(reviews[4]),
      "6aa490311aeb20f91e8b602c3c10fb7662a192f283bd4f5a9465469d9d36b250",
    );
    const leaves = (await Promise.all(reviews.map(reviewLeaf))).map(fromHex);
    assert.equal(toHex(await merkleRoot(leaves)), ROOT);
  });

  test("every proof verifies, and fails at the wrong index or root", async () => {
    for (let n = 1; n <= 13; n++) {
      const rs = Array.from({ length: n }, (_, i) => ({
        judge: "J-x",
        project: `prj_${i}`,
        values: { a: i },
      }));
      const hex = await Promise.all(rs.map(reviewLeaf));
      const leaves = hex.map(fromHex);
      const root = toHex(await merkleRoot(leaves));
      for (let i = 0; i < n; i++) {
        const path = await inclusionProof(leaves, i);
        assert.ok(
          await verifyInclusion(hex[i], i, n, path, root),
          `n=${n} i=${i}`,
        );
        if (n > 1)
          assert.equal(
            await verifyInclusion(hex[i], (i + 1) % n, n, path, root),
            false,
          );
        assert.equal(
          await verifyInclusion(hex[i], i, n, path, "0".repeat(64)),
          false,
        );
      }
    }
  });

  test("audit proves a judge's reviews and catches an edited score", async () => {
    const mine = [await reviewLeaf(reviews[0]), await reviewLeaf(reviews[2])];
    const ok = await auditReviews(reviews, ROOT, mine, "j_a1");
    assert.ok(ok.rootMatches);
    assert.deepEqual(
      ok.checks.map((c) => [c.project, c.ok]),
      [
        ["prj_01", true],
        ["prj_02", true],
      ],
    );
    const edited = reviews.map((r, i) =>
      i === 2 ? { ...r, values: { ...r.values, quality: 5 } } : r,
    );
    const bad = await auditReviews(edited, ROOT, mine, "j_a1");
    assert.equal(bad.rootMatches, false);
    assert.equal(bad.checks[1].ok, false);
    assert.equal(
      bad.checks[0].ok,
      false,
      "an edit anywhere breaks every path to the signed root",
    );
  });
});

package tests

import (
	"testing"

	"dogfood/src/core"
)

// A fixed review tree whose leaves and root are also asserted by
// src/frontend/lib/merkle.test.ts, so the Go signer and the in-browser
// checker can't drift apart. The last review exercises Go's HTML escaping.
func TestMerkleSharedVector(t *testing.T) {
	in := core.BundleInputs{Reviews: []core.BundleReview{
		{Judge: "j_a1", Project: "prj_01", Values: map[string]int{"quality": 4, "functionality": 2, "innovation": 3}},
		{Judge: "j_b2", Project: "prj_01", Values: map[string]int{"quality": 5, "functionality": 5, "innovation": 1}},
		{Judge: "j_a1", Project: "prj_02", Values: map[string]int{"quality": 1, "functionality": 3, "innovation": 2}},
		{Judge: "j_c3", Project: "prj_02", Values: map[string]int{"quality": 3, "functionality": 4, "innovation": 4}},
		{Judge: "j_<&>", Project: "prj_03", Values: map[string]int{"a<b": 2}},
	}}
	if got := core.ReviewLeaf(in.Reviews[0]); got != "bf1bb045b450be6db45078a57729ca704734101bb26752e3f0be9167d2fd2d6f" {
		t.Fatalf("leaf 0 = %s", got)
	}
	if got := core.ReviewLeaf(in.Reviews[4]); got != "6aa490311aeb20f91e8b602c3c10fb7662a192f283bd4f5a9465469d9d36b250" {
		t.Fatalf("leaf 4 (escaped) = %s", got)
	}
	if got := core.ReviewRoot(in); got != "781fefa156014ceac46a8ea361e30e1fa057ceb1236a7fa9ee5582a33936d291" {
		t.Fatalf("root = %s", got)
	}
}

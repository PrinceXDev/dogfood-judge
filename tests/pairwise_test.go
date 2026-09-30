package tests

import (
	"testing"

	"dogfood/src/core"
)

// Pairwise results carry the Elo and Davidson cross-checks next to the
// Bradley-Terry ranking, and the tie summary counts what judges actually said.
func TestPairwiseResultsIncludeEloAndTieModel(t *testing.T) {
	p := newPortal(t)
	outcomes := []string{"a", "tie", "b", "tie", "a", "a"}
	for _, o := range outcomes {
		var offer core.PairOffer
		p.must(p.api("GET", "/api/v1/events/evt_01/pairwise/next", judgeA, nil), 200).JSON(t, &offer)
		if offer.A == nil || offer.B == nil {
			t.Fatal("expected a pair")
		}
		p.must(p.api("POST", "/api/v1/events/evt_01/pairwise", judgeA, map[string]string{"a": offer.A.ID, "b": offer.B.ID, "outcome": o}), 204)
	}
	var res core.Results
	p.must(p.api("GET", "/api/v1/events/evt_01/results", orgToken, nil), 200).JSON(t, &res)
	tie := res.PairwiseTies
	if tie == nil || tie.Comparisons != len(outcomes) || tie.Ties != 2 {
		t.Fatalf("tie summary %+v, want 2 ties in %d comparisons", tie, len(outcomes))
	}
	if tie.Nu <= 0 || tie.EvenTieProb <= 0 || tie.EvenTieProb >= 1 {
		t.Fatalf("implausible tie model: %+v", tie)
	}
	seen := map[int]bool{}
	moved := false
	for _, r := range res.Pairwise {
		if r.DavidsonRank < 1 || r.DavidsonRank > len(res.Pairwise) || seen[r.DavidsonRank] {
			t.Fatalf("bad tie-aware rank %d for %s", r.DavidsonRank, r.Project.ID)
		}
		seen[r.DavidsonRank] = true
		if r.Comparisons > 0 && r.Elo != 1500 {
			moved = true
		}
	}
	if !moved {
		t.Fatal("no compared project moved off the Elo base rating")
	}
}

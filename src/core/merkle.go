package core

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
)

// Per-review inclusion proofs. The v2 manifest commits to a Merkle root over
// one leaf per review, in the bundle's sorted order. A judge's signed record
// carries their event pseudonym and the leaf hash of each of their reviews, so
// the judge (and only the judge, who alone learns the pseudonym) can prove
// each review is in the published results unchanged. It proves inclusion and
// integrity after publication; it does not prove the judge scored honestly.
//
// The tree follows RFC 6962 (Certificate Transparency): leaves are hashed as
// H(0x00 || data), interior nodes as H(0x01 || left || right), and a tree of n
// leaves splits at the largest power of two below n, so no leaf is duplicated.

// ReviewLeaf is the leaf hash of one bundle review: the pseudonym, project and
// canonical criterion values (JSON with sorted keys), separated by 0x1f.
func ReviewLeaf(r BundleReview) string {
	values, _ := json.Marshal(r.Values) // encoding/json sorts map keys
	data := append([]byte(r.Judge+"\x1f"+r.Project+"\x1f"), values...)
	return hex.EncodeToString(leafHash(data))
}

func leafHash(data []byte) []byte {
	h := sha256.New()
	h.Write([]byte{0})
	h.Write(data)
	return h.Sum(nil)
}

func nodeHash(l, r []byte) []byte {
	h := sha256.New()
	h.Write([]byte{1})
	h.Write(l)
	h.Write(r)
	return h.Sum(nil)
}

// split is the largest power of two strictly less than n (n >= 2).
func split(n int) int {
	k := 1
	for k<<1 < n {
		k <<= 1
	}
	return k
}

func root(leaves [][]byte) []byte {
	switch len(leaves) {
	case 0:
		sum := sha256.Sum256(nil)
		return sum[:]
	case 1:
		return leaves[0]
	}
	k := split(len(leaves))
	return nodeHash(root(leaves[:k]), root(leaves[k:]))
}

// ReviewRoot is the Merkle root over every review in the bundle, in order.
func ReviewRoot(in BundleInputs) string {
	return hex.EncodeToString(root(bundleLeaves(in)))
}

func bundleLeaves(in BundleInputs) [][]byte {
	out := make([][]byte, len(in.Reviews))
	for i, r := range in.Reviews {
		out[i], _ = hex.DecodeString(ReviewLeaf(r))
	}
	return out
}

// InclusionProof is the audit path for leaf i: the sibling hashes from the
// leaf up to the root.
func InclusionProof(in BundleInputs, i int) []string {
	var path []string
	var walk func(leaves [][]byte, i int)
	walk = func(leaves [][]byte, i int) {
		if len(leaves) <= 1 {
			return
		}
		k := split(len(leaves))
		if i < k {
			walk(leaves[:k], i)
			path = append(path, hex.EncodeToString(root(leaves[k:])))
		} else {
			walk(leaves[k:], i-k)
			path = append(path, hex.EncodeToString(root(leaves[:k])))
		}
	}
	walk(bundleLeaves(in), i)
	return path
}

// VerifyInclusion checks that leaf sits at index i of an n-leaf tree with the
// given root, using only the audit path (RFC 9162, section 2.1.3.2).
func VerifyInclusion(leaf string, i, n int, path []string, rootHex string) error {
	if i < 0 || i >= n {
		return errors.New("leaf index out of range")
	}
	r, err := hex.DecodeString(leaf)
	if err != nil {
		return errors.New("leaf is not hex")
	}
	fn, sn := i, n-1
	for _, p := range path {
		sib, err := hex.DecodeString(p)
		if err != nil {
			return errors.New("proof hash is not hex")
		}
		if sn == 0 {
			return errors.New("proof is longer than the tree is deep")
		}
		if fn&1 == 1 || fn == sn {
			r = nodeHash(sib, r)
			for fn&1 == 0 && fn != 0 {
				fn >>= 1
				sn >>= 1
			}
		} else {
			r = nodeHash(r, sib)
		}
		fn >>= 1
		sn >>= 1
	}
	if sn != 0 {
		return errors.New("proof is shorter than the tree is deep")
	}
	if hex.EncodeToString(r) != rootHex {
		return errors.New("path does not lead to the published root")
	}
	return nil
}

// ReviewCheck is the outcome for one leaf in a judge's record.
type ReviewCheck struct {
	Leaf    string   `json:"leaf"`
	Index   int      `json:"index"` // position in the bundle, -1 if absent
	Project string   `json:"project,omitempty"`
	Path    []string `json:"path,omitempty"`
	OK      bool     `json:"ok"`
	Problem string   `json:"problem,omitempty"`
}

// VerifyReviews proves each leaf of a judge's record is in the bundle under
// the manifest's review root. It does not check signatures; callers do.
func VerifyReviews(b ResultsBundle, m *Manifest, leaves []string) []ReviewCheck {
	index := map[string]int{}
	for i, r := range b.Inputs.Reviews {
		index[ReviewLeaf(r)] = i
	}
	n := len(b.Inputs.Reviews)
	out := make([]ReviewCheck, 0, len(leaves))
	for _, leaf := range leaves {
		c := ReviewCheck{Leaf: leaf, Index: -1}
		i, ok := index[leaf]
		if !ok {
			c.Problem = "no review in the bundle has this hash: it was changed or left out"
			out = append(out, c)
			continue
		}
		c.Index, c.Project = i, b.Inputs.Reviews[i].Project
		c.Path = InclusionProof(b.Inputs, i)
		if err := VerifyInclusion(leaf, i, n, c.Path, m.ReviewRoot); err != nil {
			c.Problem = err.Error()
		} else {
			c.OK = true
		}
		out = append(out, c)
	}
	return out
}

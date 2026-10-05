import hashlib
import json
from pathlib import Path

import pytest
from d2_record import merkle
from d2_record.merkle import MemoryTree, leaf_hash, node_hash

VECTORS = Path(__file__).resolve().parents[3] / "spec" / "record" / "vectors"
RFC = json.loads((VECTORS / "rfc6962.json").read_text())


def mth(leaves: list[bytes]) -> bytes:
    """RFC 6962 section 2.1, written as literally as possible."""
    if not leaves:
        return hashlib.sha256(b"").digest()
    if len(leaves) == 1:
        return leaves[0]
    k = 1
    while k * 2 < len(leaves):
        k *= 2
    return node_hash(mth(leaves[:k]), mth(leaves[k:]))


def rfc_tree() -> MemoryTree:
    tree = MemoryTree()
    for data in RFC["leaves"]:
        tree.append(leaf_hash(bytes.fromhex(data)))
    return tree


def test_rfc6962_roots():
    tree = rfc_tree()
    assert merkle.root(tree.subtree, 0).hex() == RFC["empty_root"]
    for size, expected in RFC["roots"].items():
        assert merkle.root(tree.subtree, int(size)).hex() == expected


@pytest.mark.parametrize("case", RFC["inclusion"], ids=lambda c: f"{c['index']}-{c['size']}")
def test_rfc6962_inclusion(case):
    tree = rfc_tree()
    proof = merkle.inclusion_proof(tree.subtree, case["index"], case["size"])
    assert [p.hex() for p in proof] == case["proof"]
    root = bytes.fromhex(RFC["roots"][str(case["size"])])
    leaf = tree.subtree(0, case["index"])
    assert merkle.verify_inclusion(case["index"], case["size"], leaf, proof, root)


@pytest.mark.parametrize("case", RFC["consistency"], ids=lambda c: f"{c['from']}-{c['to']}")
def test_rfc6962_consistency(case):
    tree = rfc_tree()
    proof = merkle.consistency_proof(tree.subtree, case["from"], case["to"])
    assert [p.hex() for p in proof] == case["proof"]
    old, new = (bytes.fromhex(RFC["roots"][str(case[k])]) for k in ("from", "to"))
    assert merkle.verify_consistency(case["from"], case["to"], old, new, proof)


def test_every_proof_up_to_40_leaves_against_the_literal_definition():
    leaves = [leaf_hash(i.to_bytes(4, "big")) for i in range(40)]
    tree = MemoryTree()
    for leaf in leaves:
        tree.append(leaf)
    roots = [mth(leaves[:n]) for n in range(41)]
    for n in range(1, 41):
        assert merkle.root(tree.subtree, n) == roots[n]
        for i in range(n):
            proof = merkle.inclusion_proof(tree.subtree, i, n)
            assert merkle.verify_inclusion(i, n, leaves[i], proof, roots[n])
            assert not merkle.verify_inclusion(i, n, leaves[(i + 1) % 40], proof, roots[n])
            if n > 1:
                assert not merkle.verify_inclusion((i + 1) % n, n, leaves[i], proof, roots[n])
        for m in range(1, n + 1):
            proof = merkle.consistency_proof(tree.subtree, m, n)
            assert merkle.verify_consistency(m, n, roots[m], roots[n], proof)
            if m < n:
                assert not merkle.verify_consistency(m, n, roots[m - 1], roots[n], proof)
                assert not merkle.verify_consistency(m, n, roots[m], roots[n - 1], proof)
                assert not merkle.verify_consistency(m, n, roots[m], roots[n], proof[:-1])


def test_verifiers_reject_malformed_input():
    tree = rfc_tree()
    root = merkle.root(tree.subtree, 8)
    leaf = tree.subtree(0, 0)
    proof = merkle.inclusion_proof(tree.subtree, 0, 8)
    assert not merkle.verify_inclusion(8, 8, leaf, proof, root)
    assert not merkle.verify_inclusion(0, 8, leaf, [*proof, proof[0]], root)
    assert not merkle.verify_inclusion(0, 8, leaf, [proof[0][:31], *proof[1:]], root)
    assert not merkle.verify_consistency(0, 8, root, root, [])
    assert not merkle.verify_consistency(9, 8, root, root, [])
    assert not merkle.verify_consistency(8, 8, root, root, [root])
    with pytest.raises(ValueError):
        merkle.inclusion_proof(tree.subtree, 8, 8)
    with pytest.raises(ValueError):
        merkle.consistency_proof(tree.subtree, 0, 8)

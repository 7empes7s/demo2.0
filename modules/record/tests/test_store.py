import hashlib

import pytest
from d2_record import merkle
from d2_record.entry import EntryError, sign_entry
from d2_record.merkle import MemoryTree
from d2_record.note import Checkpoint, Signer
from d2_record.store import Log

LOG_KEY = Signer("example.org/test-log", hashlib.sha256(b"store test log").digest())
ENTRY_KEY = Signer("example.org/test-signer", hashlib.sha256(b"store test signer").digest())
TYPES = frozenset({"matter.created", "spend"})


def entry(i: int, type_: str = "matter.created"):
    digest = "sha256:" + hashlib.sha256(str(i).encode()).hexdigest()
    return sign_entry(ENTRY_KEY, type_, digest, f"https://example.org/p/{i}")


def test_append_matches_reference_tree_and_survives_reopen(tmp_path):
    db = tmp_path / "log.db"
    log = Log(db, TYPES)
    ref = MemoryTree()
    assert log.root() == merkle.empty_root()
    for i in range(37):
        seq, leaf = log.append(entry(i))
        ref.append(leaf)
        assert seq == i
        assert log.root() == merkle.root(ref.subtree, i + 1)
    log.close()

    log = Log(db, TYPES)
    assert log.size == 37
    assert log.root() == merkle.root(ref.subtree, 37)
    log.append_many([entry(i) for i in range(37, 50)])
    for i in range(37, 50):
        ref.append(entry(i).leaf_hash())
    for n in (1, 2, 3, 31, 32, 33, 50):
        assert log.root(n) == merkle.root(ref.subtree, n)
        for i in (0, n // 2, n - 1):
            assert log.inclusion_proof(i, n) == merkle.inclusion_proof(ref.subtree, i, n)
        for m in (1, n // 2 or 1, n):
            assert log.consistency_proof(m, n) == merkle.consistency_proof(ref.subtree, m, n)
    assert log.entry(7) == entry(7)


def test_bad_entry_rolls_back_the_whole_batch(tmp_path):
    log = Log(tmp_path / "log.db", TYPES)
    log.append(entry(0))
    root = log.root()
    forged = entry(2)
    forged = type(forged)(**{**forged.to_dict(), "payload_uri": "https://example.org/other"})
    with pytest.raises(EntryError, match="signature"):
        log.append_many([entry(1), forged])
    with pytest.raises(EntryError, match="unknown entry type"):
        log.append(entry(3, "not.a.type"))
    assert log.size == 1
    assert log.root() == root
    log.append(entry(1))
    assert log.size == 2


def test_proofs_beyond_the_tree_are_refused(tmp_path):
    log = Log(tmp_path / "log.db", TYPES)
    log.append(entry(0))
    with pytest.raises(ValueError):
        log.inclusion_proof(0, 2)
    with pytest.raises(ValueError):
        log.consistency_proof(1, 2)


def test_checkpoint_is_signed_stable_and_verifiable(tmp_path):
    log = Log(tmp_path / "log.db", TYPES)
    log.append_many([entry(i) for i in range(5)])
    note = log.checkpoint(LOG_KEY, now=1_800_000_000)
    assert log.checkpoint(LOG_KEY, now=1_900_000_000) == note
    cp = Checkpoint.verify(note, LOG_KEY.verifier)
    assert (cp.origin, cp.size, cp.root, cp.timestamp) == (
        "example.org/test-log",
        5,
        log.root(),
        1_800_000_000,
    )
    log.append(entry(5))
    assert log.latest_checkpoint() == note
    assert Checkpoint.verify(log.checkpoint(LOG_KEY), LOG_KEY.verifier).size == 6


def test_commits_are_durable_before_a_checkpoint_is_signed(tmp_path):
    log = Log(tmp_path / "log.db", TYPES)
    assert log.db.execute("PRAGMA synchronous").fetchone()[0] == 2  # FULL


def test_a_second_writer_on_the_same_database_is_picked_up(tmp_path):
    db = tmp_path / "log.db"
    server, cli = Log(db, TYPES), Log(db, TYPES)
    ref = MemoryTree()
    for i in range(20):
        writer = server if i % 3 else cli  # interleave the two connections
        seq, leaf = writer.append(entry(i))
        ref.append(leaf)
        assert seq == i
    assert cli.inclusion_proof(0, 20) == merkle.inclusion_proof(ref.subtree, 0, 20)
    cli.refresh()
    assert cli.size == 20 and cli.root() == merkle.root(ref.subtree, 20)
    assert server.size == 20 and server.root() == merkle.root(ref.subtree, 20)
    cli.append(entry(20))
    ref.append(entry(20).leaf_hash())
    note = server.checkpoint(LOG_KEY)  # signs the state on disk, not a stale one
    assert Checkpoint.verify(note, LOG_KEY.verifier).root == merkle.root(ref.subtree, 21)


def test_a_failed_batch_leaves_nothing_on_disk(tmp_path):
    db = tmp_path / "log.db"
    log = Log(db, TYPES)
    log.append_many([entry(i) for i in range(3)])
    root = log.root()
    with pytest.raises(EntryError):
        log.append_many([entry(3), entry(4, "not.a.type")])
    log.close()
    log = Log(db, TYPES)
    assert (log.size, log.root()) == (3, root)
    assert log.db.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == 3
    log.append(entry(3))
    assert log.size == 4

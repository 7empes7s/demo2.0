//! End-to-end rounds through the operator path and the verifier, and the refusals the operator
//! must make before anything reaches the board.

use d2_booth::wire::{kind, Close, ROUND_SCHEMA};
use d2_booth::{
    run_dkg, verify_board, Board, BoothError, Phase, Round, RoundParams, RoundPublic, Voter,
};
use rand::rngs::StdRng;
use rand::SeedableRng;

fn params(round_id: &str, options: &[&str], n: u32, k: u32) -> RoundParams {
    RoundParams {
        schema: ROUND_SCHEMA.to_string(),
        round_id: round_id.to_string(),
        matter_id: "matter:flow".to_string(),
        options: options.iter().map(|s| s.to_string()).collect(),
        guardians: n,
        threshold: k,
    }
}

#[test]
fn full_round_with_every_threshold_subset() {
    let mut rng = StdRng::seed_from_u64(11);
    let p = params("booth:flow", &["a", "b", "c", "d"], 4, 3);
    let (commitments, keys) = run_dkg(&p.round_id, 4, 3, &mut rng).unwrap();
    let mut round = Round::open(&p, &commitments).unwrap();
    assert_eq!(round.state().phase(), Phase::Voting);
    let public = round.state().round_public().unwrap().clone();
    let voters: Vec<Voter> = (0..25)
        .map(|i| Voter::new(&format!("nym-{i}"), &mut rng))
        .collect();
    for v in &voters {
        round.signup(&v.signup()).unwrap();
    }
    let mut expected = [0u64; 4];
    for (i, v) in voters.iter().enumerate() {
        let choice = (i * 7) % 4;
        expected[choice] += 1;
        round
            .cast(&v.ballot(&public, choice, &mut rng).unwrap())
            .unwrap();
    }
    round.close().unwrap();
    let aggregates = round.state().aggregates();
    for key in &keys {
        round
            .add_partial(&key.partial_decryption(&p.round_id, &aggregates, &mut rng))
            .unwrap();
    }
    // Any 3 of the 4 guardians open the same counts; the tally names the set it used.
    let closed = round.clone();
    for set in [[1u32, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]] {
        let mut r = closed.clone();
        let tally = r.tally(&set).unwrap();
        assert_eq!(tally.counts, expected.to_vec(), "set {set:?}");
        assert_eq!(tally.counted, 25);
        assert_eq!(tally.signups, 25);
        let verified = verify_board(r.board()).unwrap();
        assert_eq!(verified, tally);
    }
    // All four also work (the Lagrange set is just larger).
    let mut r = closed.clone();
    assert_eq!(r.tally(&[1, 2, 3, 4]).unwrap().counts, expected.to_vec());
    // Two are not enough.
    let mut r = closed.clone();
    assert_eq!(
        r.tally(&[1, 2]),
        Err(BoothError::BelowThreshold { have: 2, need: 3 })
    );
    // A guardian listed twice is not two guardians.
    let mut r = closed.clone();
    assert!(matches!(r.tally(&[1, 1, 2]), Err(BoothError::Malformed(_))));
    // The verifier re-derives everything: a board without the tally has no tally.
    assert_eq!(verify_board(closed.board()), Err(BoothError::NoTally));
}

#[test]
fn operator_refuses_what_must_not_reach_the_board() {
    let mut rng = StdRng::seed_from_u64(12);
    let p = params("booth:refuse", &["yes", "no"], 2, 2);
    let (commitments, keys) = run_dkg(&p.round_id, 2, 2, &mut rng).unwrap();
    let mut round = Round::open(&p, &commitments).unwrap();
    let public = round.state().round_public().unwrap().clone();
    let alice = Voter::new("alice", &mut rng);
    let mallory = Voter::new("mallory", &mut rng);
    round.signup(&alice.signup()).unwrap();
    let before = round.board().entries.len();

    // Second sign-up of the same pseudonym (even with a new key).
    let alice_again = Voter::new("alice", &mut rng);
    assert_eq!(
        round.signup(&alice_again.signup()),
        Err(BoothError::DuplicateSignup("alice".to_string()))
    );
    // A ballot from someone who never signed up.
    assert_eq!(
        round.cast(&mallory.ballot(&public, 0, &mut rng).unwrap()),
        Err(BoothError::NotSignedUp("mallory".to_string()))
    );
    // A ballot signed by the wrong key under alice's pseudonym.
    assert_eq!(
        round.cast(&alice_again.ballot(&public, 0, &mut rng).unwrap()),
        Err(BoothError::NotSignedUp("alice".to_string()))
    );
    // A ballot for another round or under another key.
    let other = RoundPublic {
        round_id: "booth:other".to_string(),
        ..public.clone()
    };
    assert!(matches!(
        round.cast(&alice.ballot(&other, 0, &mut rng).unwrap()),
        Err(BoothError::Malformed(_))
    ));
    let (other_commitments, _) = run_dkg(&p.round_id, 2, 2, &mut rng).unwrap();
    let other_key = Round::open(&p, &other_commitments)
        .unwrap()
        .state()
        .round_public()
        .unwrap()
        .clone();
    assert_eq!(
        round.cast(&alice.ballot(&other_key, 0, &mut rng).unwrap()),
        Err(BoothError::ProofFailed)
    );
    // A choice outside the options never becomes a ballot.
    assert!(matches!(
        alice.ballot(&public, 2, &mut rng),
        Err(BoothError::Malformed(_))
    ));
    // Nothing of the above was published.
    assert_eq!(round.board().entries.len(), before);
    assert_eq!(round.state().ballot_count(), 0);

    // A valid ballot, then close; a ballot after close is out of order.
    round
        .cast(&alice.ballot(&public, 1, &mut rng).unwrap())
        .unwrap();
    round.close().unwrap();
    assert!(matches!(
        round.cast(&alice.ballot(&public, 0, &mut rng).unwrap()),
        Err(BoothError::OutOfOrder { .. })
    ));
    // A tally before any partial decryption is below threshold; after one, still.
    assert_eq!(
        round.tally(&[]),
        Err(BoothError::BelowThreshold { have: 0, need: 2 })
    );
    let aggregates = round.state().aggregates();
    round
        .add_partial(&keys[0].partial_decryption(&p.round_id, &aggregates, &mut rng))
        .unwrap();
    // The same guardian twice is refused.
    assert!(matches!(
        round.add_partial(&keys[0].partial_decryption(&p.round_id, &aggregates, &mut rng)),
        Err(BoothError::Malformed(_))
    ));
    // A partial decryption over the wrong aggregates (another guardian's secret) fails.
    let mut forged = keys[1].partial_decryption(&p.round_id, &aggregates, &mut rng);
    forged.guardian = 2;
    forged.shares.swap(0, 1);
    assert_eq!(round.add_partial(&forged), Err(BoothError::ProofFailed));
    round
        .add_partial(&keys[1].partial_decryption(&p.round_id, &aggregates, &mut rng))
        .unwrap();
    let tally = round.tally(&[1, 2]).unwrap();
    assert_eq!(tally.counts, vec![0, 1]);
    assert_eq!(verify_board(round.board()).unwrap(), tally);
}

#[test]
fn the_verifier_is_strict_about_order_and_shape() {
    let mut rng = StdRng::seed_from_u64(13);
    let p = params("booth:order", &["x", "y"], 1, 1);
    let (commitments, _) = run_dkg(&p.round_id, 1, 1, &mut rng).unwrap();
    let round = Round::open(&p, &commitments).unwrap();
    // Close as the very first entry.
    let mut b = Board::new();
    b.append(kind::CLOSE, &Close {}).unwrap();
    assert!(matches!(
        verify_board(&b),
        Err(BoothError::OutOfOrder { seq: 0, .. })
    ));
    // Params with threshold above n, or one option, never get going.
    for (bad, what) in [
        (params("booth:p", &["x", "y"], 2, 3), "threshold"),
        (params("booth:p", &["x"], 1, 1), "one option"),
        (params("booth:p", &["x", "y"], 0, 0), "no guardians"),
        (params("", &["x", "y"], 1, 1), "empty id"),
        (params("booth:p\u{e9}", &["x", "y"], 1, 1), "non-ascii id"),
    ] {
        let mut b = Board::new();
        b.append(kind::PARAMS, &bad).unwrap();
        assert!(
            matches!(verify_board(&b), Err(BoothError::Params(_))),
            "{what}"
        );
        assert!(Round::open(&bad, &commitments).is_err(), "{what}");
    }
    // An extra entry of a kind nobody knows.
    let mut b = round.board().clone();
    b.append("note", &serde_json::json!({"text": "hi"}))
        .unwrap();
    assert!(matches!(
        verify_board(&b),
        Err(BoothError::OutOfOrder { .. })
    ));
    // A board whose schema is not ours.
    let mut b = round.board().clone();
    b.schema = "other".to_string();
    assert!(matches!(verify_board(&b), Err(BoothError::Malformed(_))));
}

#[test]
fn a_coerced_ballot_replayed_after_the_re_vote_is_refused() {
    // Review finding on PR #31: anyone who can append to the board copied a voter's first
    // (coerced) ballot after its re-vote, rehashed, and "last counts" reinstated it.
    let mut rng = StdRng::seed_from_u64(14);
    let p = params("booth:replay", &["yes", "no"], 2, 2);
    let (commitments, keys) = run_dkg(&p.round_id, 2, 2, &mut rng).unwrap();
    let mut round = Round::open(&p, &commitments).unwrap();
    let public = round.state().round_public().unwrap().clone();
    let alice = Voter::new("alice", &mut rng);
    let bob = Voter::new("bob", &mut rng);
    round.signup(&alice.signup()).unwrap();
    round.signup(&bob.signup()).unwrap();
    let coerced = alice.ballot(&public, 0, &mut rng).unwrap();
    round.cast(&coerced).unwrap();
    let coerced_seq = round.board().entries.len() as u64 - 1;
    round
        .cast(&bob.ballot(&public, 1, &mut rng).unwrap())
        .unwrap();
    let re_vote = alice.ballot(&public, 1, &mut rng).unwrap();
    assert!(re_vote.ballot_seq > coerced.ballot_seq);
    round.cast(&re_vote).unwrap();
    let re_vote_seq = round.board().entries.len() as u64 - 1;

    // The operator refuses the replay, and an equal or lower counter signed by the voter.
    let before = round.board().entries.len();
    assert_eq!(
        round.cast(&coerced),
        Err(BoothError::BallotReplay("alice".to_string()))
    );
    for stale in [coerced.ballot_seq, re_vote.ballot_seq] {
        let b = alice.ballot_with_seq(&public, 0, stale, &mut rng).unwrap();
        assert_eq!(
            round.cast(&b),
            Err(BoothError::BallotReplay("alice".to_string()))
        );
    }
    assert_eq!(round.board().entries.len(), before);

    // The honest board: only the re-vote counts.
    round.close().unwrap();
    let aggregates = round.state().aggregates();
    for key in &keys {
        round
            .add_partial(&key.partial_decryption(&p.round_id, &aggregates, &mut rng))
            .unwrap();
    }
    let tally = round.tally(&[1, 2]).unwrap();
    assert_eq!(tally.counts, vec![0, 2]);
    assert_eq!(verify_board(round.board()).unwrap(), tally);

    // The reviewer's attack on the published board: copy the coerced ballot entry right after
    // the re-vote and rehash the chain. The verifier now fails the board at the copy.
    let attacked = d2_booth::vectors::mutate(
        round.board(),
        &d2_booth::vectors::Mutation::Copy {
            seq: coerced_seq,
            after: re_vote_seq,
        },
    )
    .unwrap();
    attacked.verify_chain().unwrap();
    assert_eq!(
        verify_board(&attacked),
        Err(BoothError::BallotReplay("alice".to_string()))
    );
    // Same through the JSON a verifier reads.
    let text = serde_json::to_string(&attacked).unwrap();
    let parsed = d2_booth::board::parse_board(&text).unwrap();
    assert_eq!(verify_board(&parsed).unwrap_err().code(), "ballot_replay");
}

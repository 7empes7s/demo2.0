//! End-to-end: enrol with the mock identity provider, present in contexts, verify, and every
//! must-fail case from the Door protocol.

use d2_door::{
    verify, Credential, Disclosure, EnrolError, Holder, IdentityProvider, Issuer, IssuerKey,
    IssuerSecret, MemoryStore, MockIdProvider, Presentation, UniquenessKey, UniquenessStore,
    VerifyError,
};
use rand::rngs::OsRng;

const FROM: &str = "2026-01-01T00:00:00Z";
const TO: &str = "2026-12-31T23:59:59Z";

struct World {
    issuer: Issuer<MemoryStore>,
    provider: MockIdProvider,
}

fn world() -> World {
    let mut issuer = Issuer::new(UniquenessKey::generate(&mut OsRng), MemoryStore::new());
    issuer.add_epoch(IssuerSecret::generate(1, FROM, TO, &mut OsRng));
    issuer.add_epoch(IssuerSecret::generate(2, FROM, TO, &mut OsRng));
    World {
        issuer,
        provider: MockIdProvider::demo(),
    }
}

/// Full enrolment for one device token in one epoch.
fn enrol(w: &mut World, token: &str, epoch: u32) -> Result<(Holder, Credential), EnrolError> {
    let assertion = w.provider.assert_identity(token).unwrap();
    let holder = Holder::new(&mut OsRng);
    let commit = holder.commit().unwrap();
    let issuance = w
        .issuer
        .enrol(&assertion, epoch, &commit.commitment, &mut OsRng)?;
    let key = w.issuer.issuer_key(epoch).unwrap().clone();
    let credential = holder.finalize(&key, &issuance, &commit.blind).unwrap();
    Ok((holder, credential))
}

fn key(w: &World, epoch: u32) -> IssuerKey {
    w.issuer.issuer_key(epoch).unwrap().clone()
}

const ESCH: Disclosure = Disclosure {
    jurisdiction_levels: 2,
    adult: true,
    epoch: true,
};

#[test]
fn one_enrolment_per_person_per_epoch() {
    let mut w = world();
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    assert_eq!(alice.attributes.jurisdiction_path, "lu.esch");
    assert!(alice.attributes.adult);
    assert_eq!(w.issuer.store().count(1), 1);

    // Same person, second device: refused in the same epoch.
    assert_eq!(
        enrol(&mut w, "alice-tablet", 1).unwrap_err(),
        EnrolError::AlreadyEnrolled { epoch: 1 }
    );
    assert_eq!(
        enrol(&mut w, "alice-phone", 1).unwrap_err(),
        EnrolError::AlreadyEnrolled { epoch: 1 }
    );
    assert_eq!(w.issuer.store().count(1), 1);

    // Another person is fine, and the same person is fine in the next epoch.
    enrol(&mut w, "bob-phone", 1).unwrap();
    enrol(&mut w, "alice-tablet", 2).unwrap();
    assert_eq!(w.issuer.store().count(1), 2);
    assert_eq!(w.issuer.store().count(2), 1);

    assert_eq!(
        enrol(&mut w, "carol-phone", 9).unwrap_err(),
        EnrolError::UnknownEpoch { epoch: 9 }
    );
}

#[test]
fn door_never_sees_the_holder_secret() {
    let mut w = world();
    let assertion = w.provider.assert_identity("alice-phone").unwrap();
    let holder = Holder::new(&mut OsRng);
    let commit = holder.commit().unwrap();
    let issuance = w
        .issuer
        .enrol(&assertion, 1, &commit.commitment, &mut OsRng)
        .unwrap();
    let secret = holder.secret_hex();
    // What Door receives and what Door returns carry no copy of `s`.
    assert!(!hex::encode(&commit.commitment).contains(&secret));
    assert!(!serde_json::to_string(&issuance).unwrap().contains(&secret));
    let credential = holder
        .finalize(&key(&w, 1), &issuance, &commit.blind)
        .unwrap();
    // The final pseudonym secret is s plus Door's entropy, so neither side chose it alone.
    assert_ne!(credential.nym_secret, secret);
    assert_ne!(credential.nym_secret, issuance.signer_nym_entropy);
}

#[test]
fn wrong_key_or_attributes_fail_finalisation() {
    let mut w = world();
    let assertion = w.provider.assert_identity("alice-phone").unwrap();
    let holder = Holder::new(&mut OsRng);
    let commit = holder.commit().unwrap();
    let issuance = w
        .issuer
        .enrol(&assertion, 1, &commit.commitment, &mut OsRng)
        .unwrap();
    // A key for another epoch.
    assert!(holder
        .finalize(&key(&w, 2), &issuance, &commit.blind)
        .is_err());
    // Door claims it signed adult=true for a minor: the holder catches it.
    let mut lying = issuance.clone();
    lying.attributes.adult = !lying.attributes.adult;
    assert!(matches!(
        holder.finalize(&key(&w, 1), &lying, &commit.blind),
        Err(d2_door::HolderError::BadSignature(_))
    ));
    // Someone else's blinding factor.
    let other = Holder::new(&mut OsRng).commit().unwrap();
    assert!(holder
        .finalize(&key(&w, 1), &issuance, &other.blind)
        .is_err());
    // A commitment that is not one.
    assert!(matches!(
        w.issuer
            .enrol(&assertion, 2, b"not a commitment", &mut OsRng),
        Err(EnrolError::InvalidCommitment(_))
    ));
}

#[test]
fn same_context_same_pseudonym_fresh_proof() {
    let mut w = world();
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    let k = key(&w, 1);
    let p1 = alice.present(&k, "agora:lu.esch", b"c1", &ESCH).unwrap();
    let p2 = alice.present(&k, "agora:lu.esch", b"c2", &ESCH).unwrap();
    assert_eq!(p1.pseudonym, p2.pseudonym);
    assert_ne!(p1.proof, p2.proof, "each presentation is a fresh proof");
    let v1 = verify(&k, &p1, "agora:lu.esch", b"c1", &ESCH).unwrap();
    let v2 = verify(&k, &p2, "agora:lu.esch", b"c2", &ESCH).unwrap();
    assert_eq!(v1.pseudonym, v2.pseudonym);
    assert_eq!(v1.disclosed.jurisdiction_path.as_deref(), Some("lu.esch"));
    assert_eq!(v1.disclosed.adult, Some(true));
    assert_eq!(v1.disclosed.epoch, Some(1));
    assert_eq!(v1.epoch, 1);
    assert!(v1.pseudonym.nym().starts_with("nym-"));
}

#[test]
fn different_contexts_different_pseudonyms_and_nothing_shared() {
    let mut w = world();
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    let (_, bob) = enrol(&mut w, "bob-phone", 1).unwrap();
    let k = key(&w, 1);
    let a_esch = alice.present(&k, "agora:lu.esch", b"c", &ESCH).unwrap();
    let a_lu = alice.present(&k, "agora:lu", b"c", &ESCH).unwrap();
    let a_booth = alice.present(&k, "booth:round-7", b"c", &ESCH).unwrap();
    let b_esch = bob.present(&k, "agora:lu.esch", b"c", &ESCH).unwrap();

    // Different contexts: different pseudonyms. Different people, same context: different too.
    let nyms = [&a_esch, &a_lu, &a_booth, &b_esch].map(|p| p.pseudonym.nym());
    for i in 0..nyms.len() {
        for j in 0..i {
            assert_ne!(nyms[i], nyms[j]);
        }
    }
    for (p, ctx) in [
        (&a_esch, "agora:lu.esch"),
        (&a_lu, "agora:lu"),
        (&a_booth, "booth:round-7"),
    ] {
        verify(&k, p, ctx, b"c", &ESCH).unwrap();
    }

    // Nothing in two presentations of the same credential is shared beyond the disclosed
    // attributes (identical for everyone in Esch), the epoch and the challenge: the pseudonym
    // and the proof differ, and the proof bytes of one never appear in the other.
    assert_ne!(a_esch.pseudonym, a_lu.pseudonym);
    assert_ne!(a_esch.proof, a_lu.proof);
    assert!(!a_lu.proof.contains(a_esch.pseudonym.as_hex()));
    assert!(!a_esch.proof.contains(a_lu.pseudonym.as_hex()));
    for window in a_esch.proof.as_bytes().chunks(64) {
        let w = std::str::from_utf8(window).unwrap();
        assert!(!a_lu.proof.contains(w), "proofs share a 32-byte run");
    }
    // Alice's and Bob's presentations in Esch look the same apart from pseudonym and proof.
    assert_eq!(a_esch.disclosed, b_esch.disclosed);
}

#[test]
fn replay_in_another_context_fails() {
    let mut w = world();
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    let k = key(&w, 1);
    let p = alice.present(&k, "agora:lu.esch", b"c", &ESCH).unwrap();
    // The verifier of another context sees the mismatch before touching the proof.
    assert_eq!(
        verify(&k, &p, "agora:lu", b"c", &ESCH).unwrap_err(),
        VerifyError::ContextMismatch {
            presentation: "agora:lu.esch".into(),
            verifier: "agora:lu".into()
        }
    );
    // Editing the context field to match does not help: the proof is bound to the context.
    let mut forged = p.clone();
    forged.context = "agora:lu".into();
    assert_eq!(
        verify(&k, &forged, "agora:lu", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof
    );
    // Replaying the same proof against a new challenge fails too.
    assert_eq!(
        verify(&k, &p, "agora:lu.esch", b"c2", &ESCH).unwrap_err(),
        VerifyError::ChallengeMismatch
    );
    let mut forged = p.clone();
    forged.challenge = hex::encode(b"c2");
    assert_eq!(
        verify(&k, &forged, "agora:lu.esch", b"c2", &ESCH).unwrap_err(),
        VerifyError::InvalidProof
    );
}

#[test]
fn wrong_epoch_key_fails() {
    let mut w = world();
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    let p = alice
        .present(&key(&w, 1), "agora:lu.esch", b"c", &ESCH)
        .unwrap();
    assert_eq!(
        verify(&key(&w, 2), &p, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::EpochMismatch {
            presentation: 1,
            key: 2
        }
    );
    let mut forged = p.clone();
    forged.epoch = 2;
    forged.disclosed.epoch = Some(2);
    assert_eq!(
        verify(&key(&w, 2), &forged, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof
    );
    // A key of the right epoch number but from another Door.
    let other = IssuerSecret::generate(1, FROM, TO, &mut OsRng);
    assert_eq!(
        verify(other.public(), &p, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof
    );
}

#[test]
fn tampered_disclosure_or_proof_fails() {
    let mut w = world();
    let (_, bob) = enrol(&mut w, "bob-phone", 1).unwrap();
    let k = key(&w, 1);
    let p = bob.present(&k, "agora:lu.esch", b"c", &ESCH).unwrap();
    verify(&k, &p, "agora:lu.esch", b"c", &ESCH).unwrap();

    let mut t = p.clone();
    t.disclosed.jurisdiction_path = Some("lu.luxembourg".into());
    assert_eq!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof
    );

    // Claiming more levels than were disclosed (Bob's deeper path happens to be right, but
    // the proof only covers two levels).
    let mut t = p.clone();
    t.disclosed.jurisdiction_path = Some("lu.esch.42063".into());
    assert_eq!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::Malformed {
            what: "proof".into(),
            detail: "expected 400 bytes for 5 disclosed messages, got 432".into()
        }
    );

    let mut t = p.clone();
    t.disclosed.epoch = Some(3);
    assert_eq!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof
    );

    // Flip the lowest bit of the proof's last scalar (the challenge): still decodes, no longer
    // verifies.
    let mut t = p.clone();
    let mut bytes = hex::decode(&t.proof).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    t.proof = hex::encode(bytes);
    assert_eq!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof
    );
    // Flip a bit inside a curve point: either it no longer decodes or it no longer verifies.
    let mut t = p.clone();
    let mut bytes = hex::decode(&t.proof).unwrap();
    bytes[100] ^= 1;
    t.proof = hex::encode(bytes);
    assert!(matches!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof | VerifyError::Malformed { .. }
    ));

    // Swap in another holder's pseudonym.
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    let a = alice.present(&k, "agora:lu.esch", b"c", &ESCH).unwrap();
    let mut t = p.clone();
    t.pseudonym = a.pseudonym.clone();
    assert_eq!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof
    );

    // Garbage.
    let mut t = p.clone();
    t.proof = "zz".into();
    assert!(matches!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::Malformed { .. }
    ));
    let mut t = p.clone();
    t.proof.truncate(40);
    assert!(matches!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::Malformed { .. }
    ));
}

#[test]
fn a_minor_cannot_claim_to_be_adult() {
    let mut w = world();
    let (_, carol) = enrol(&mut w, "carol-phone", 1).unwrap();
    assert!(!carol.attributes.adult);
    let k = key(&w, 1);
    let adult_only = Disclosure {
        jurisdiction_levels: 1,
        adult: true,
        epoch: false,
    };
    // An honest presentation says adult=false; the verifier sees it and decides.
    let p = carol
        .present(&k, "booth:round-1", b"c", &adult_only)
        .unwrap();
    let v = verify(&k, &p, "booth:round-1", b"c", &adult_only).unwrap();
    assert_eq!(v.disclosed.adult, Some(false));
    assert_eq!(v.disclosed.jurisdiction_path.as_deref(), Some("lu"));
    assert_eq!(v.disclosed.epoch, None);

    // Editing the disclosure to adult=true breaks the proof.
    let mut forged = p.clone();
    forged.disclosed.adult = Some(true);
    assert_eq!(
        verify(&k, &forged, "booth:round-1", b"c", &adult_only).unwrap_err(),
        VerifyError::InvalidProof
    );

    // Hiding the flag when the verifier requires it is refused before the proof is checked.
    let hidden = carol
        .present(
            &k,
            "booth:round-1",
            b"c",
            &Disclosure {
                adult: false,
                ..adult_only
            },
        )
        .unwrap();
    assert_eq!(
        verify(&k, &hidden, "booth:round-1", b"c", &adult_only).unwrap_err(),
        VerifyError::MissingDisclosure("adult".into())
    );
    // Hiding the jurisdiction likewise.
    assert_eq!(
        verify(
            &k,
            &p,
            "booth:round-1",
            b"c",
            &Disclosure {
                jurisdiction_levels: 2,
                ..adult_only
            }
        )
        .unwrap_err(),
        VerifyError::MissingDisclosure("jurisdiction (1 of 2 levels)".into())
    );
}

#[test]
fn disclosure_is_minimal_and_prefix_bounded() {
    let mut w = world();
    let (_, bob) = enrol(&mut w, "bob-phone", 1).unwrap();
    let k = key(&w, 1);
    let nothing = Disclosure::default();
    let p = bob
        .present(&k, "commons:matter-12", b"c", &nothing)
        .unwrap();
    let v = verify(&k, &p, "commons:matter-12", b"c", &nothing).unwrap();
    assert_eq!(v.disclosed, Default::default());
    let text = serde_json::to_string(&p).unwrap();
    assert!(
        !text.contains("42063") && !text.contains("esch") && !text.contains(&bob.attributes.rid)
    );

    let country = Disclosure {
        jurisdiction_levels: 1,
        ..nothing
    };
    let p = bob.present(&k, "agora:lu", b"c", &country).unwrap();
    assert_eq!(p.disclosed.jurisdiction_path.as_deref(), Some("lu"));
    assert!(!serde_json::to_string(&p).unwrap().contains("esch"));
    verify(&k, &p, "agora:lu", b"c", &country).unwrap();

    // Deeper than the credential: Alice has two levels.
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    assert!(matches!(
        alice.present(
            &k,
            "x",
            b"c",
            &Disclosure {
                jurisdiction_levels: 3,
                ..nothing
            }
        ),
        Err(d2_door::HolderError::JurisdictionTooDeep {
            requested: 3,
            available: 2
        })
    ));
}

#[test]
fn serialisation_round_trips() {
    let mut w = world();
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    let k = key(&w, 1);
    let k2: IssuerKey = serde_json::from_str(&serde_json::to_string(&k).unwrap()).unwrap();
    assert_eq!(k, k2);
    assert_eq!(k.bbs_public_key.len(), 192);
    let c2: Credential = serde_json::from_str(&serde_json::to_string(&alice).unwrap()).unwrap();
    assert_eq!(alice, c2);
    let p = c2.present(&k2, "agora:lu.esch", b"c", &ESCH).unwrap();
    let p2: Presentation = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
    assert_eq!(p, p2);
    verify(&k2, &p2, "agora:lu.esch", b"c", &ESCH).unwrap();
    let keys = w.issuer.issuer_keys();
    assert_eq!(keys.iter().map(|k| k.epoch).collect::<Vec<_>>(), vec![1, 2]);
}

#[test]
fn issuer_key_from_seed_is_deterministic() {
    let a = IssuerSecret::from_seed(1, FROM, TO, &[9u8; 32]);
    let b = IssuerSecret::from_seed(1, FROM, TO, &[9u8; 32]);
    let c = IssuerSecret::from_seed(2, FROM, TO, &[9u8; 32]);
    assert_eq!(a.public(), b.public());
    assert_ne!(
        a.public().bbs_public_key,
        c.public().bbs_public_key,
        "epoch is in key_info"
    );
}

#[test]
fn malformed_input_is_an_error_not_a_panic() {
    let mut w = world();
    let assertion = w.provider.assert_identity("alice-phone").unwrap();
    for len in [0usize, 1, 47, 48, 79, 80, 143, 145, 400] {
        let bytes = vec![0x55u8; len];
        assert!(
            matches!(
                w.issuer.enrol(&assertion, 1, &bytes, &mut OsRng),
                Err(EnrolError::InvalidCommitment(_))
            ),
            "commitment of {len} bytes"
        );
    }
    let (_, alice) = enrol(&mut w, "alice-phone", 1).unwrap();
    let k = key(&w, 1);
    let p = alice.present(&k, "agora:lu.esch", b"c", &ESCH).unwrap();
    assert_eq!(hex::decode(&p.proof).unwrap().len(), d2_door::proof_len(4));
    for len in [0usize, 10, 100, 239, 240, 271, 272, 300, 400, 2000] {
        let mut t = p.clone();
        t.proof = hex::encode(vec![0x55u8; len]);
        assert!(
            matches!(
                verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
                VerifyError::Malformed { .. }
            ),
            "proof of {len} bytes"
        );
    }
    // Right length, wrong content: decodes or not, never panics.
    let mut t = p.clone();
    t.proof = hex::encode(vec![0x55u8; d2_door::proof_len(4)]);
    assert!(matches!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::InvalidProof | VerifyError::Malformed { .. }
    ));
    // A proof that disclosed less than it claims is caught by the length check.
    let fewer = alice
        .present(&k, "agora:lu.esch", b"c", &Disclosure::default())
        .unwrap();
    let mut t = p.clone();
    t.proof = fewer.proof;
    assert!(matches!(
        verify(&k, &t, "agora:lu.esch", b"c", &ESCH).unwrap_err(),
        VerifyError::Malformed { .. }
    ));
}

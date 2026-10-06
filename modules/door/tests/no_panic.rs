//! Every externally supplied byte or hex field in the verifier, holder and issuer APIs, filled
//! with random content of random length, gives an error or a result and never a panic.
//! Deterministic: a fixed-seed generator, so a failure reproduces.

use d2_door::uniqueness::BlindedPerson;
use d2_door::{
    verify, Disclosure, Holder, IdentityProvider, Issuer, IssuerSecret, MemoryStore,
    MockIdProvider, Presentation, UniquenessKey,
};
use rand::rngs::{OsRng, StdRng};
use rand::{Rng, SeedableRng};
use std::panic::{catch_unwind, AssertUnwindSafe};

const FROM: &str = "2026-01-01T00:00:00Z";
const TO: &str = "2026-12-31T23:59:59Z";
const ESCH: Disclosure = Disclosure {
    jurisdiction_levels: 2,
    adult: true,
    epoch: true,
};
/// Byte lengths tried for every field: 0 to 299.
const MAX_LEN: usize = 300;

/// Random bytes of `len`.
fn bytes(rng: &mut StdRng, len: usize) -> Vec<u8> {
    (0..len).map(|_| rng.gen()).collect()
}

/// For a byte length, the inputs a hex field gets: valid lowercase hex of random bytes, the
/// same in uppercase, and a string of `2 * len` characters mixing hex digits with characters
/// that are not hex (odd lengths come from the truncated variant).
fn hex_inputs(rng: &mut StdRng, len: usize) -> Vec<String> {
    const CHARS: &[char] = &[
        '0', '1', '9', 'a', 'f', 'A', 'F', 'g', 'z', ' ', '\n', '-', 'é', '\u{0}',
    ];
    let lower = hex::encode(bytes(rng, len));
    let upper = lower.to_uppercase();
    let garbage: String = (0..2 * len)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())])
        .collect();
    let odd = lower.chars().skip(1).collect();
    vec![lower, upper, garbage, odd]
}

/// Run `f`, recording `what` if it panics.
fn no_panic<T>(panics: &mut Vec<String>, what: String, f: impl FnOnce() -> T) {
    if catch_unwind(AssertUnwindSafe(f)).is_err() {
        panics.push(what);
    }
}

#[test]
fn random_input_in_every_external_field_never_panics() {
    let mut rng = StdRng::seed_from_u64(0xd002);
    let mut panics = Vec::new();

    // A real world to start every mutation from.
    let provider = MockIdProvider::demo();
    let mut door = Issuer::new(UniquenessKey::generate(&mut OsRng), MemoryStore::new());
    door.add_epoch(IssuerSecret::generate(1, FROM, TO, &mut OsRng))
        .unwrap();
    let key = door.issuer_key(1).unwrap().clone();
    let assertion = provider.assert_identity("alice-phone").unwrap();
    let holder = Holder::new(&mut OsRng);
    let commit = holder.commit().unwrap();
    let issuance = door
        .enrol(&assertion, 1, &commit.commitment, &mut OsRng)
        .unwrap();
    let credential = holder.finalize(&key, &issuance, &commit.blind).unwrap();
    let presentation = credential
        .present(&key, "agora:lu.esch", b"c", &ESCH)
        .unwrap();
    let presentation_json = serde_json::to_value(&presentation).unwrap();
    verify(&key, &presentation, "agora:lu.esch", b"c", &ESCH).unwrap();
    let oprf = UniquenessKey::generate(&mut OsRng);
    let bob = provider.assert_identity("bob-phone").unwrap();

    for len in 0..MAX_LEN {
        // Raw byte inputs.
        let raw = bytes(&mut rng, len);
        no_panic(&mut panics, format!("enrol commitment len {len}"), || {
            let _ = door.enrol(&bob, 1, &raw, &mut OsRng);
        });
        no_panic(&mut panics, format!("verify challenge len {len}"), || {
            let _ = verify(&key, &presentation, "agora:lu.esch", &raw, &ESCH);
        });
        no_panic(&mut panics, format!("present challenge len {len}"), || {
            let _ = credential.present(&key, "agora:lu.esch", &raw, &ESCH);
        });
        no_panic(
            &mut panics,
            format!("oprf blind_evaluate len {len}"),
            || {
                let _ = oprf.blind_evaluate(&raw);
            },
        );
        no_panic(&mut panics, format!("oprf finalize len {len}"), || {
            let _ = BlindedPerson::blind("test-person-0001", &mut OsRng).finalize(&raw);
        });

        for (variant, text) in hex_inputs(&mut rng, len).into_iter().enumerate() {
            let tag = |field: &str| format!("{field} len {len} variant {variant}");

            // Verifier: issuer key and every presentation field.
            let mut k = key.clone();
            k.bbs_public_key = text.clone();
            no_panic(&mut panics, tag("verify bbs_public_key"), || {
                let _ = verify(&k, &presentation, "agora:lu.esch", b"c", &ESCH);
            });
            k.ciphersuite = text.clone();
            no_panic(&mut panics, tag("verify ciphersuite"), || {
                let _ = verify(&k, &presentation, "agora:lu.esch", b"c", &ESCH);
            });
            for field in ["proof", "pseudonym", "challenge", "context"] {
                let mut json = presentation_json.clone();
                json[field] = text.clone().into();
                no_panic(&mut panics, tag(&format!("presentation {field}")), || {
                    if let Ok(p) = serde_json::from_value::<Presentation>(json) {
                        let _ = verify(&key, &p, "agora:lu.esch", b"c", &ESCH);
                    }
                });
            }
            let mut p = presentation.clone();
            p.disclosed.jurisdiction_path = Some(text.clone());
            no_panic(&mut panics, tag("presentation jurisdiction_path"), || {
                let _ = verify(&key, &p, "agora:lu.esch", b"c", &ESCH);
            });
            no_panic(&mut panics, tag("verify context argument"), || {
                let _ = verify(&key, &presentation, &text, b"c", &ESCH);
            });

            // Holder, finalisation: issuer key and every issuance field.
            no_panic(&mut panics, tag("finalize bbs_public_key"), || {
                let _ = holder.finalize(&k, &issuance, &commit.blind);
            });
            let mut k = key.clone();
            k.bbs_public_key = text.clone();
            no_panic(
                &mut panics,
                tag("finalize bbs_public_key (suite ok)"),
                || {
                    let _ = holder.finalize(&k, &issuance, &commit.blind);
                },
            );
            for field in ["blind_signature", "signer_nym_entropy", "rid", "path"] {
                let mut i = issuance.clone();
                match field {
                    "blind_signature" => i.blind_signature = text.clone(),
                    "signer_nym_entropy" => i.signer_nym_entropy = text.clone(),
                    "rid" => i.attributes.rid = text.clone(),
                    _ => i.attributes.jurisdiction_path = text.clone(),
                }
                no_panic(&mut panics, tag(&format!("finalize {field}")), || {
                    let _ = holder.finalize(&key, &i, &commit.blind);
                });
            }

            // Holder, presentation: issuer key and every credential field.
            no_panic(&mut panics, tag("present bbs_public_key"), || {
                let _ = credential.present(&k, "agora:lu.esch", b"c", &ESCH);
            });
            for field in ["signature", "nym_secret", "blind", "rid", "path"] {
                let mut c = credential.clone();
                match field {
                    "signature" => c.signature = text.clone(),
                    "nym_secret" => c.nym_secret = text.clone(),
                    "blind" => c.blind = text.clone(),
                    "rid" => c.attributes.rid = text.clone(),
                    _ => c.attributes.jurisdiction_path = text.clone(),
                }
                no_panic(&mut panics, tag(&format!("present {field}")), || {
                    let _ = c.present(&key, "agora:lu.esch", b"c", &ESCH);
                });
            }
            no_panic(&mut panics, tag("present context argument"), || {
                let _ = credential.present(&key, &text, b"c", &ESCH);
            });

            // Issuer: the identity assertion's free-text fields.
            let mut a = bob.clone();
            a.person_id = text.clone();
            no_panic(&mut panics, tag("enrol person_id"), || {
                let _ = door.enrol(&a, 1, &commit.commitment, &mut OsRng);
            });
            let mut a = bob.clone();
            a.jurisdiction_path = text.clone();
            no_panic(&mut panics, tag("enrol jurisdiction_path"), || {
                let _ = door.enrol(&a, 1, &commit.commitment, &mut OsRng);
            });
        }
    }
    assert!(panics.is_empty(), "{} panics: {panics:#?}", panics.len());
}

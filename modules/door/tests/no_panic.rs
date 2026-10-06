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

/// The verifier service's input: raw request bytes into the HTTP reader, and random or
/// wrongly-typed values in every field of the `POST /presentations/verify` body (and of the
/// presentation inside it) into the handler. Every case gives a response, never a panic, and
/// only a well-formed request for a valid presentation gives 200.
#[test]
fn random_http_input_never_panics() {
    use d2_door::http::{handle, read_request, verify_body, Request};
    use serde_json::{json, Value};
    use std::collections::BTreeMap;
    use std::time::Duration;

    let mut rng = StdRng::seed_from_u64(0xd003);
    let mut panics = Vec::new();

    let provider = MockIdProvider::demo();
    let mut door = Issuer::new(UniquenessKey::generate(&mut OsRng), MemoryStore::new());
    door.add_epoch(IssuerSecret::generate(1, FROM, TO, &mut OsRng))
        .unwrap();
    let key = door.issuer_key(1).unwrap().clone();
    let keys = BTreeMap::from([(1, key.clone())]);
    let holder = Holder::new(&mut OsRng);
    let commit = holder.commit().unwrap();
    let issuance = door
        .enrol(
            &provider.assert_identity("alice-phone").unwrap(),
            1,
            &commit.commitment,
            &mut OsRng,
        )
        .unwrap();
    let credential = holder.finalize(&key, &issuance, &commit.blind).unwrap();
    let presentation = credential
        .present(&key, "agora:lu.esch", b"c", &ESCH)
        .unwrap();
    let good = json!({
        "presentation": presentation,
        "context": "agora:lu.esch",
        "challenge": "63",
        "epoch": 1,
        "require": {"jurisdiction_levels": 2, "adult": true, "epoch": true},
    });
    let good_bytes = serde_json::to_vec(&good).unwrap();
    assert_eq!(verify_body(&keys, &good_bytes).status, 200);
    let wire = |body: &[u8]| {
        let mut out = format!(
            "POST /presentations/verify HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    };
    let good_wire = wire(&good_bytes);
    let timeout = Duration::from_secs(1);

    // Values of every JSON type, of growing size, for each field.
    let odd_values = |rng: &mut StdRng, len: usize| -> Vec<Value> {
        let mut v: Vec<Value> = hex_inputs(rng, len).into_iter().map(Value::from).collect();
        v.extend([
            Value::Null,
            json!(len),
            json!(-(len as i64) - 1),
            json!(u64::MAX - len as u64),
            json!(len as f64 + 0.5),
            json!(len % 2 == 0),
            json!(vec![len; len % 7]),
            json!({ "x": len }),
        ]);
        v
    };

    for len in 0..MAX_LEN {
        // Raw bytes as a whole request, and as a body behind a valid head.
        let raw = bytes(&mut rng, len * 7);
        no_panic(
            &mut panics,
            format!("raw request len {}", raw.len()),
            || {
                if let Ok(r) = read_request(&mut &raw[..], timeout) {
                    let _ = handle(&keys, &r);
                }
            },
        );
        let framed = wire(&raw);
        no_panic(&mut panics, format!("raw body len {}", raw.len()), || {
            let r = read_request(&mut &framed[..], timeout).expect("framed request reads");
            assert_ne!(handle(&keys, &r).status, 200);
        });

        // A valid request cut short, or with one byte changed.
        let cut = good_wire
            .get(..len * good_wire.len() / MAX_LEN)
            .unwrap_or(&[]);
        no_panic(
            &mut panics,
            format!("truncated request at {}", cut.len()),
            || {
                if let Ok(r) = read_request(&mut &cut[..], timeout) {
                    let _ = handle(&keys, &r);
                }
            },
        );
        let mut flipped = good_wire.clone();
        let at = rng.gen_range(0..flipped.len());
        flipped[at] = rng.gen();
        no_panic(&mut panics, format!("byte {at} changed"), || {
            if let Ok(r) = read_request(&mut &flipped[..], timeout) {
                let _ = handle(&keys, &r);
            }
        });

        // Heads with odd Content-Length values and odd request lines.
        let length_text: String = hex_inputs(&mut rng, len % 12).remove(2);
        let head = format!(
            "POST /presentations/verify HTTP/1.1\r\nContent-Length: {length_text}\r\n\r\n{{}}"
        );
        no_panic(
            &mut panics,
            format!("content-length {length_text:?}"),
            || {
                if let Ok(r) = read_request(&mut head.as_bytes(), timeout) {
                    let _ = handle(&keys, &r);
                }
            },
        );
        let line = format!(
            "{} HTTP/1.1\r\n\r\n",
            String::from_utf8_lossy(&bytes(&mut rng, len % 40))
        );
        no_panic(&mut panics, format!("request line len {len}"), || {
            if let Ok(r) = read_request(&mut line.as_bytes(), timeout) {
                let _ = handle(&keys, &r);
            }
        });

        // Every body field and every presentation field, with values of every type.
        for (variant, value) in odd_values(&mut rng, len).into_iter().enumerate() {
            let fields: [&[&str]; 13] = [
                &["presentation"],
                &["context"],
                &["challenge"],
                &["epoch"],
                &["require"],
                &["require", "jurisdiction_levels"],
                &["presentation", "epoch"],
                &["presentation", "context"],
                &["presentation", "challenge"],
                &["presentation", "pseudonym"],
                &["presentation", "proof"],
                &["presentation", "disclosed"],
                &["presentation", "disclosed", "jurisdiction_path"],
            ];
            for path in fields {
                let mut body = good.clone();
                let mut slot = &mut body;
                for p in path {
                    slot = &mut slot[*p];
                }
                *slot = value.clone();
                let bytes = serde_json::to_vec(&body).unwrap();
                no_panic(
                    &mut panics,
                    format!("{} len {len} variant {variant}", path.join(".")),
                    || {
                        let request = Request {
                            method: "POST".into(),
                            path: "/presentations/verify".into(),
                            body: bytes,
                        };
                        let _ = handle(&keys, &request);
                    },
                );
            }
        }
    }
    assert!(panics.is_empty(), "{} panics: {panics:#?}", panics.len());
}

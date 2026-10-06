//! Phase 2 acceptance, Sybil part (docs/architecture/00-overview.md section 7, Phase 2):
//! "1,000 synthetic enrolment attempts with 100 duplicate identities produce exactly 900
//! credentials." The unlinkability part is in `tests/unlinkability.rs`.
//!
//! Every attempt is a full enrolment: a fresh holder secret (a new device), a blind commitment,
//! Door's uniqueness check and blind signature, and the holder's finalisation, which checks the
//! signature. Nothing is mocked except the identity provider's assertion.

use d2_door::{
    Credential, EnrolError, Holder, IdentityAssertion, Issuer, IssuerSecret, MemoryStore,
    UniquenessKey, UniquenessStore,
};
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

const FROM: &str = "2026-01-01T00:00:00Z";
const TO: &str = "2026-12-31T23:59:59Z";
const EPOCH: u32 = 1;

const PATHS: [&str; 4] = [
    "lu.lu-canton-esch-sur-alzette.lu-commune-esch-sur-alzette",
    "lu.lu-canton-luxembourg.lu-commune-luxembourg",
    "lu.lu-canton-vianden",
    "lu.lu-canton-capellen",
];

fn door(seed: u8) -> Issuer<MemoryStore> {
    let mut issuer = Issuer::new(UniquenessKey::from_seed([seed; 32]), MemoryStore::new());
    issuer
        .add_epoch(IssuerSecret::from_seed(EPOCH, FROM, TO, &[seed; 32]))
        .unwrap();
    issuer
}

/// A synthetic person. Even-numbered people come from a real-provider adapter (13-digit id,
/// all starting with `000000`, which no real Luxembourg number does, since the first eight
/// digits are a birth date), odd-numbered ones from the mock provider.
fn person(i: usize) -> (String, &'static str) {
    if i % 2 == 0 {
        (format!("000000{i:07}"), "eudi")
    } else {
        (format!("test-person-{i:04}"), "mock")
    }
}

/// One enrolment attempt from a new device. Returns the credential or Door's refusal.
fn attempt(
    door: &mut Issuer<MemoryStore>,
    assertion: &IdentityAssertion,
    rng: &mut StdRng,
) -> Result<Credential, EnrolError> {
    let holder = Holder::new(rng);
    let commit = holder.commit().unwrap();
    let issuance = door.enrol(assertion, EPOCH, &commit.commitment, rng)?;
    let key = door.issuer_key(EPOCH).unwrap().clone();
    Ok(holder
        .finalize(&key, &issuance, &commit.blind)
        .expect("Door's signature must verify"))
}

#[test]
fn sybil_1000_attempts_with_100_duplicates_issue_exactly_900_credentials() {
    let started = Instant::now();
    let mut rng = StdRng::seed_from_u64(0x5eed_d002);
    const PEOPLE: usize = 900;

    // 900 distinct people, each with a home jurisdiction and an adult flag.
    let base: Vec<IdentityAssertion> = (0..PEOPLE)
        .map(|i| {
            let (person_id, provider) = person(i);
            IdentityAssertion {
                person_id,
                adult: i % 10 != 0,
                jurisdiction_path: PATHS[i % PATHS.len()].to_string(),
                provider: provider.to_string(),
            }
        })
        .collect();

    // 100 duplicates of those people: 70 people try once more, 10 try three more times. Each
    // duplicate is a new device (fresh holder secret, done in `attempt`) and some also change
    // what the provider says: another provider for the same id, a new address, an age flag
    // that differs. None of that changes the person id, so none may get a second credential.
    let mut picks: Vec<usize> = (0..PEOPLE).collect();
    picks.shuffle(&mut rng);
    let mut duplicate_of: Vec<usize> = picks[..70].to_vec();
    for &p in &picks[70..80] {
        duplicate_of.extend([p, p, p]);
    }
    assert_eq!(duplicate_of.len(), 100);
    let mut attempts: Vec<(usize, IdentityAssertion)> = base.iter().cloned().enumerate().collect();
    for (k, &p) in duplicate_of.iter().enumerate() {
        let mut a = base[p].clone();
        match k % 4 {
            0 => {} // same assertion, other device
            1 => {
                // same id through another adapter of the same kind
                a.provider = match a.provider.as_str() {
                    "eudi" => "luxtrust".to_string(),
                    _ => "mock".to_string(),
                };
            }
            2 => a.jurisdiction_path = PATHS[(k + p + 1) % PATHS.len()].to_string(),
            _ => a.adult = !a.adult,
        }
        attempts.push((p, a));
    }
    assert_eq!(attempts.len(), 1000);

    // Order: shuffled, so duplicates land anywhere, including before the person's first
    // attempt (then that later "original" is the one refused). Whoever comes first wins.
    attempts.shuffle(&mut rng);
    assert!(
        attempts
            .iter()
            .take(PEOPLE)
            .filter(|(p, _)| duplicate_of.contains(p))
            .count()
            > 0,
        "some duplicated person must appear in the first 900 attempts"
    );

    let mut door = door(7);
    let mut issued: BTreeMap<usize, Credential> = BTreeMap::new();
    let mut refused: Vec<(usize, EnrolError)> = Vec::new();
    let mut by_device = 0usize;
    for (p, assertion) in &attempts {
        let had = issued.contains_key(p);
        match attempt(&mut door, assertion, &mut rng) {
            Ok(credential) => {
                assert!(!had, "person {p} got a second credential");
                assert_eq!(
                    credential.attributes.jurisdiction_path,
                    assertion.jurisdiction_path
                );
                issued.insert(*p, credential);
            }
            Err(e) => {
                assert!(had, "person {p} refused on first attempt: {e}");
                refused.push((*p, e));
            }
        }
        by_device += 1;
    }
    assert_eq!(by_device, 1000);

    // Exactly 900 credentials, one per person, and exactly 100 refusals, each the precise
    // uniqueness error.
    assert_eq!(issued.len(), 900);
    assert_eq!(
        issued.keys().copied().collect::<Vec<_>>(),
        (0..PEOPLE).collect::<Vec<_>>()
    );
    assert_eq!(refused.len(), 100);
    for (p, e) in &refused {
        assert_eq!(
            *e,
            EnrolError::AlreadyEnrolled { epoch: EPOCH },
            "person {p}"
        );
    }
    let refused_people: BTreeMap<usize, usize> =
        refused.iter().fold(BTreeMap::new(), |mut m, (p, _)| {
            *m.entry(*p).or_default() += 1;
            m
        });
    assert_eq!(refused_people.len(), 80);
    assert_eq!(refused_people.values().filter(|&&n| n == 3).count(), 10);
    assert_eq!(door.store().count(EPOCH), 900);

    // 900 distinct credentials: distinct signatures, revocation handles and pseudonym secrets.
    let sigs: BTreeSet<&str> = issued.values().map(|c| c.signature.as_str()).collect();
    let rids: BTreeSet<&str> = issued.values().map(|c| c.attributes.rid.as_str()).collect();
    let nyms: BTreeSet<&str> = issued.values().map(|c| c.nym_secret.as_str()).collect();
    assert_eq!((sigs.len(), rids.len(), nyms.len()), (900, 900, 900));

    // The credentials work: a sample presents and verifies (all 900 already passed the
    // holder's signature check in `finalize`).
    let key = door.issuer_key(EPOCH).unwrap().clone();
    let wants = d2_door::Disclosure {
        jurisdiction_levels: 1,
        adult: true,
        epoch: false,
    };
    for p in (0..PEOPLE).step_by(90) {
        let challenge: [u8; 32] = rng.gen();
        let pres = issued[&p]
            .present(&key, "agora:lu", &challenge, &wants)
            .unwrap();
        d2_door::verify(&key, &pres, "agora:lu", &challenge, &wants).unwrap();
    }

    eprintln!(
        "sybil: 1000 attempts, {} credentials, {} refused (already_enrolled), {:.1} s",
        issued.len(),
        refused.len(),
        started.elapsed().as_secs_f64()
    );
}

#[test]
fn person_id_spellings_never_get_a_second_credential() {
    let mut rng = StdRng::seed_from_u64(0x5eed_d003);
    let mut door = door(8);
    let real = IdentityAssertion {
        person_id: "0000001234567".into(),
        adult: true,
        jurisdiction_path: PATHS[0].into(),
        provider: "eudi".into(),
    };
    let mock = IdentityAssertion {
        person_id: "test-person-0042".into(),
        adult: true,
        jurisdiction_path: PATHS[1].into(),
        provider: "mock".into(),
    };
    attempt(&mut door, &real, &mut rng).unwrap();
    attempt(&mut door, &mock, &mut rng).unwrap();

    // Other spellings an adapter could plausibly emit for the same person. Each must be refused
    // outright (not normalised into a fresh uniqueness key), so it can never be a second
    // credential. The exact canonical spelling is a duplicate.
    let real_variants = [
        " 0000001234567",
        "0000001234567 ",
        "0000001234567\n",
        "\t0000001234567",
        "000000123456",    // leading zero dropped
        "00000001234567",  // zero added
        "0000 0012 34567", // grouped
        "000000-1234567",
        "0000001234567\u{200b}",      // zero-width space
        "\u{feff}0000001234567",      // byte-order mark
        "0000001234567\u{a0}",        // no-break space
        "００００００１２３４５６７", // fullwidth digits
        "٠٠٠٠٠٠١٢٣٤٥٦٧",              // Arabic-Indic digits
        "LU0000001234567",
    ];
    for v in real_variants {
        for provider in ["eudi", "luxtrust"] {
            let a = IdentityAssertion {
                person_id: v.into(),
                provider: provider.into(),
                ..real.clone()
            };
            match attempt(&mut door, &a, &mut rng) {
                Err(EnrolError::InvalidAttribute(_)) => {}
                other => panic!("{provider} {v:?}: expected invalid_attribute, got {other:?}"),
            }
        }
    }
    let mock_variants = [
        "Test-person-0042",
        "TEST-PERSON-0042",
        "test-person-042",
        "test-person-00042",
        "test_person-0042",
        " test-person-0042",
        "test-person-0042 ",
        "test-person-００４２",
        "test-person-0042\u{200b}",
    ];
    for v in mock_variants {
        let a = IdentityAssertion {
            person_id: v.into(),
            ..mock.clone()
        };
        match attempt(&mut door, &a, &mut rng) {
            Err(EnrolError::InvalidAttribute(_)) => {}
            other => panic!("mock {v:?}: expected invalid_attribute, got {other:?}"),
        }
    }
    // A mock-shaped id from a real provider, and a real-shaped id from the mock provider.
    for (id, provider) in [("test-person-0042", "eudi"), ("0000001234567", "mock")] {
        let a = IdentityAssertion {
            person_id: id.into(),
            provider: provider.into(),
            ..real.clone()
        };
        assert!(matches!(
            attempt(&mut door, &a, &mut rng),
            Err(EnrolError::InvalidAttribute(_))
        ));
    }
    // The canonical spelling again, through either real adapter: the uniqueness error.
    for provider in ["eudi", "luxtrust"] {
        let a = IdentityAssertion {
            provider: provider.into(),
            ..real.clone()
        };
        assert_eq!(
            attempt(&mut door, &a, &mut rng).unwrap_err(),
            EnrolError::AlreadyEnrolled { epoch: EPOCH }
        );
    }
    assert_eq!(
        attempt(&mut door, &mock, &mut rng).unwrap_err(),
        EnrolError::AlreadyEnrolled { epoch: EPOCH }
    );
    assert_eq!(door.store().count(EPOCH), 2);
}

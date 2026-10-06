//! Phase 2 acceptance, unlinkability part (docs/architecture/00-overview.md section 7, Phase 2):
//! "the Door operator, given its full database and all Agora logs, cannot link any credential to
//! an identity better than chance". This is the automated part; the red-team report is a human
//! job. Findings and what remains are in `spec/door/unlinkability.md`.
//!
//! The harness enrols 200 synthetic residents, spread over Charter jurisdictions in proportion
//! to their real populations (`charter/data/lu-jurisdictions.json`), lets them post and upvote
//! in Agora contexts (`agora:<jurisdiction id>`), and hands an attacker:
//!
//! - everything Door has: per enrolment the identity (person id, address, adult flag), the
//!   uniqueness key `u`, the holder's commitment, the blind signature it produced, its share of
//!   the pseudonym secret and the revocation handle `rid` (more than Door's store keeps: Door is
//!   assumed to log every enrolment in full);
//! - everything Agora sees: every presentation in full (proof, pseudonym, disclosed attributes,
//!   context, challenge), which is more than Agora stores (it keeps the `nym` only).
//!
//! The log is shuffled: ordering and timing are out of scope here (see the report). "Chance" is
//! not 1/N: a presentation discloses the jurisdiction of its context, so the best an attacker
//! can do without breaking anything is guess uniformly among the enrolled adults of that
//! jurisdiction. Each attack's success count is checked against that baseline plus a
//! one-sided 4.5 standard deviation margin (false alarm about 3 in a million), and a control
//! run with a planted leak shows the same attacks do find a link when there is one.

use d2_door::{
    verify, Credential, Disclosure, Holder, IdentityAssertion, Issuer, IssuerKey, IssuerSecret,
    MemoryStore, Presentation, UniquenessKey,
};
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::time::Instant;
use zkryptium::bbsplus::ciphersuites::BbsCiphersuite;
use zkryptium::utils::message::bbsplus_message::BBSplusMessage;

const EPOCH: u32 = 1;
const ENROLEES: usize = 200;
/// Margin in standard deviations above the chance expectation.
const Z: f64 = 4.5;

// ---------------------------------------------------------------- population and enrolment

/// Charter jurisdictions as Door paths (ids root first, joined by `.`), each with the residents
/// that live directly in it: a canton's population minus the communes listed under it.
fn charter_residence() -> Vec<(String, u64)> {
    let file = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../charter/data/lu-jurisdictions.json"
    );
    let data: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    let list = data
        .as_object()
        .unwrap()
        .values()
        .find_map(|v| v.as_array())
        .unwrap();
    let parent: HashMap<String, Option<String>> = list
        .iter()
        .map(|j| {
            (
                j["id"].as_str().unwrap().to_string(),
                j["parent_id"].as_str().map(str::to_string),
            )
        })
        .collect();
    let path = |id: &str| {
        let mut chain = vec![id.to_string()];
        while let Some(Some(p)) = parent.get(chain.last().unwrap()) {
            chain.push(p.clone());
        }
        chain.reverse();
        chain.join(".")
    };
    let mut own: BTreeMap<String, i64> = list
        .iter()
        .map(|j| {
            (
                path(j["id"].as_str().unwrap()),
                j["population"].as_i64().unwrap(),
            )
        })
        .collect();
    for j in list {
        if let Some(p) = j["parent_id"].as_str() {
            *own.get_mut(&path(p)).unwrap() -= j["population"].as_i64().unwrap();
        }
    }
    own.into_iter()
        .filter(|(_, n)| *n > 0)
        .map(|(p, n)| (p, n as u64))
        .collect()
}

/// `n` enrolees over the residence table, largest remainder.
fn allocate(table: &[(String, u64)], n: usize) -> Vec<String> {
    let total: u64 = table.iter().map(|(_, p)| p).sum();
    let mut seats: Vec<(usize, usize, f64)> = table
        .iter()
        .enumerate()
        .map(|(i, (_, p))| {
            let exact = *p as f64 * n as f64 / total as f64;
            (i, exact.floor() as usize, exact - exact.floor())
        })
        .collect();
    let left = n - seats.iter().map(|s| s.1).sum::<usize>();
    let mut order: Vec<usize> = (0..seats.len()).collect();
    order.sort_by(|a, b| seats[*b].2.total_cmp(&seats[*a].2));
    for &i in order.iter().take(left) {
        seats[i].1 += 1;
    }
    seats
        .iter()
        .flat_map(|(i, k, _)| std::iter::repeat_n(table[*i].0.clone(), *k))
        .collect()
}

/// Everything Door knows about one enrolment, as byte strings, plus the identity.
struct DoorRecord {
    path: String,
    /// Binary values: `u`, commitment, blind signature, Door's pseudonym entropy, `rid`, and the
    /// `rid` message as the BBS library hashes it to a scalar (under each of its API ids).
    binary: Vec<Vec<u8>>,
}

impl DoorRecord {
    /// The same values as the lowercase hex text the JSON formats use.
    fn hex(&self) -> Vec<String> {
        self.binary.iter().map(hex::encode).collect()
    }
    fn concat(&self) -> Vec<u8> {
        self.binary.concat()
    }
}

struct World {
    key: IssuerKey,
    door: Vec<DoorRecord>,
    credentials: Vec<Credential>,
}

fn enrol_world(rng: &mut StdRng) -> World {
    let mut issuer = Issuer::new(UniquenessKey::generate(rng), MemoryStore::new());
    issuer
        .add_epoch(IssuerSecret::generate(
            EPOCH,
            "2026-01-01T00:00:00Z",
            "2026-12-31T23:59:59Z",
            rng,
        ))
        .unwrap();
    let key = issuer.issuer_key(EPOCH).unwrap().clone();
    let paths = allocate(&charter_residence(), ENROLEES);
    assert_eq!(paths.len(), ENROLEES);
    let mut door = Vec::new();
    let mut credentials = Vec::new();
    for (i, path) in paths.into_iter().enumerate() {
        let assertion = IdentityAssertion {
            person_id: format!("test-person-{i:04}"),
            adult: true,
            jurisdiction_path: path.clone(),
            provider: "mock".into(),
        };
        let holder = Holder::new(rng);
        let commit = holder.commit().unwrap();
        let issuance = issuer
            .enrol(&assertion, EPOCH, &commit.commitment, rng)
            .unwrap();
        let credential = holder.finalize(&key, &issuance, &commit.blind).unwrap();
        let rid = hex::decode(&issuance.attributes.rid).unwrap();
        let rid_message = format!("rid={}", issuance.attributes.rid).into_bytes();
        let mut binary = vec![
            hex::decode(issuer.uniqueness_key(&assertion.person_id)).unwrap(),
            commit.commitment.clone(),
            hex::decode(&issuance.blind_signature).unwrap(),
            hex::decode(&issuance.signer_nym_entropy).unwrap(),
            rid,
            rid_message.clone(),
        ];
        for api_id in [
            d2_door::Suite::API_ID,
            d2_door::Suite::API_ID_BLIND,
            d2_door::Suite::API_ID_NYM,
        ] {
            let scalar = BBSplusMessage::map_message_to_scalar_as_hash::<d2_door::Suite>(
                &rid_message,
                api_id,
            )
            .unwrap();
            binary.push(scalar.to_bytes_be().to_vec());
        }
        door.push(DoorRecord { path, binary });
        credentials.push(credential);
    }
    World {
        key,
        door,
        credentials,
    }
}

// ---------------------------------------------------------------- Agora activity

/// One entry of the Agora log as the attacker gets it. `holder` is the ground truth, never
/// shown to an attack.
struct Entry {
    presentation: Presentation,
    json: String,
    /// Proof bytes then pseudonym bytes.
    bytes: Vec<u8>,
    holder: usize,
}

/// Each enrolee acts in each Agora area that contains their address with probability 0.6 (at
/// least one), and acts a second time there with probability 0.25 (a post and an upvote, say).
fn activity(w: &World, rng: &mut StdRng) -> Vec<Entry> {
    let mut log = Vec::new();
    for (holder, credential) in w.credentials.iter().enumerate() {
        let levels: Vec<&str> = credential.attributes.jurisdiction_path.split('.').collect();
        let mut areas: Vec<usize> = (1..=levels.len()).filter(|_| rng.gen_bool(0.6)).collect();
        if areas.is_empty() {
            areas.push(levels.len());
        }
        for depth in areas {
            let times = if rng.gen_bool(0.25) { 2 } else { 1 };
            for _ in 0..times {
                let context = format!("agora:{}", levels[depth - 1]);
                let challenge: [u8; 32] = rng.gen();
                let wants = Disclosure {
                    jurisdiction_levels: depth,
                    adult: true,
                    epoch: false,
                };
                let p = credential
                    .present(&w.key, &context, &challenge, &wants)
                    .unwrap();
                // What Agora's Door check does: verify for its own context and challenge.
                verify(&w.key, &p, &context, &challenge, &wants).unwrap();
                let mut bytes = hex::decode(&p.proof).unwrap();
                bytes.extend_from_slice(p.pseudonym.point_bytes());
                log.push(Entry {
                    json: serde_json::to_string(&p).unwrap(),
                    presentation: p,
                    bytes,
                    holder,
                });
            }
        }
    }
    // Timing is out of scope: the attacker gets the log in random order.
    log.shuffle(rng);
    log
}

// ---------------------------------------------------------------- statistics

/// Successes of a guessing attack against what pure chance would give.
struct Score {
    name: &'static str,
    trials: usize,
    successes: usize,
    expected: f64,
    sd: f64,
}

impl Score {
    fn new(name: &'static str, chance: &[f64], hits: impl Iterator<Item = bool>) -> Self {
        let successes = hits.filter(|h| *h).count();
        Score {
            name,
            trials: chance.len(),
            successes,
            expected: chance.iter().sum(),
            sd: chance.iter().map(|p| p * (1.0 - p)).sum::<f64>().sqrt(),
        }
    }
    fn bound(&self) -> f64 {
        self.expected + Z * self.sd + 1.0
    }
    fn report(&self) -> String {
        format!(
            "{:<34} {:>4} trials  {:>4} linked ({:>5.1}%)  chance {:>6.1} ({:>5.1}%)  sd {:>4.1}  bound {:>6.1}",
            self.name,
            self.trials,
            self.successes,
            100.0 * self.successes as f64 / self.trials as f64,
            self.expected,
            100.0 * self.expected / self.trials as f64,
            self.sd,
            self.bound()
        )
    }
    fn assert_chance(&self) {
        assert!(
            (self.successes as f64) <= self.bound(),
            "linked better than chance: {}",
            self.report()
        );
    }
}

/// The enrolees an attacker cannot tell apart from the disclosed attributes alone: adults whose
/// address starts with the disclosed jurisdiction path.
fn anonymity_set(door: &[DoorRecord], p: &Presentation) -> Vec<usize> {
    let disclosed: Vec<&str> = p
        .disclosed
        .jurisdiction_path
        .as_deref()
        .map(|s| s.split('.').collect())
        .unwrap_or_default();
    door.iter()
        .enumerate()
        .filter(|(_, r)| {
            r.path
                .split('.')
                .take(disclosed.len())
                .eq(disclosed.iter().copied())
        })
        .map(|(i, _)| i)
        .collect()
}

// ---------------------------------------------------------------- attacks

/// Attack 1, exact bytes: any 8-byte run of anything Door holds (binary) or any 16-character
/// run of its hex text that appears in a presentation (decoded bytes or the JSON as logged)
/// names the enrolee. Otherwise guess within the anonymity set. Returns guesses and hits.
fn exact_bytes_attack(
    door: &[DoorRecord],
    log: &[(Vec<u8>, String, Vec<usize>)],
    rng: &mut StdRng,
) -> (Vec<usize>, usize) {
    let mut binary: HashMap<&[u8], usize> = HashMap::new();
    let hexes: Vec<Vec<String>> = door.iter().map(DoorRecord::hex).collect();
    let mut text: HashMap<&[u8], usize> = HashMap::new();
    for (i, r) in door.iter().enumerate() {
        for v in &r.binary {
            for w in v.windows(8) {
                binary.insert(w, i);
            }
        }
        for h in &hexes[i] {
            for w in h.as_bytes().windows(16) {
                text.insert(w, i);
            }
        }
    }
    let mut hits = 0;
    let guesses = log
        .iter()
        .map(|(bytes, json, set)| {
            let found = bytes
                .windows(8)
                .find_map(|w| binary.get(w))
                .or_else(|| json.as_bytes().windows(16).find_map(|w| text.get(w)));
            match found {
                Some(&i) => {
                    hits += 1;
                    i
                }
                None => *set.choose(rng).unwrap(),
            }
        })
        .collect();
    (guesses, hits)
}

/// The set of byte pairs (2-grams) in a byte string, as a 65 536-bit set.
fn grams(bytes: &[u8]) -> Vec<u64> {
    let mut set = vec![0u64; 1024];
    for w in bytes.windows(2) {
        let g = (usize::from(w[0]) << 8) | usize::from(w[1]);
        set[g >> 6] |= 1 << (g & 63);
    }
    set
}

fn shared_grams(set: &[u64], bytes: &[u8]) -> usize {
    let mut seen = HashSet::new();
    bytes
        .windows(2)
        .map(|w| (usize::from(w[0]) << 8) | usize::from(w[1]))
        .filter(|g| set[g >> 6] & (1 << (g & 63)) != 0 && seen.insert(*g))
        .count()
}

/// Attack 2, similarity: within the anonymity set, pick the enrolee whose Door material shares
/// the most byte pairs with the presentation (ties at random). Catches partial leaks that do
/// not survive as a whole 8-byte run.
fn similarity_attack(
    door: &[DoorRecord],
    log: &[(Vec<u8>, String, Vec<usize>)],
    rng: &mut StdRng,
) -> Vec<usize> {
    let sets: Vec<Vec<u64>> = door.iter().map(|r| grams(&r.concat())).collect();
    log.iter()
        .map(|(bytes, _, set)| {
            let scored: Vec<(usize, usize)> = set
                .iter()
                .map(|&i| (i, shared_grams(&sets[i], bytes)))
                .collect();
            let best = scored.iter().map(|s| s.1).max().unwrap();
            let top: Vec<usize> = scored.iter().filter(|s| s.1 == best).map(|s| s.0).collect();
            *top.choose(rng).unwrap()
        })
        .collect()
}

// ---------------------------------------------------------------- the test

#[test]
fn door_and_agora_together_link_no_better_than_chance() {
    let started = Instant::now();
    let mut rng = StdRng::seed_from_u64(0x5eed_d004);
    let w = enrol_world(&mut rng);
    let log = activity(&w, &mut rng);
    let built = started.elapsed().as_secs_f64();
    let mut lines = vec![format!(
        "unlinkability: {ENROLEES} enrolees, {} presentations in {} Agora contexts",
        log.len(),
        log.iter()
            .map(|e| e.presentation.context.as_str())
            .collect::<BTreeSet<_>>()
            .len()
    )];

    // Pseudonyms behave: one per (holder, context), never shared between holders or contexts.
    let mut by_owner: BTreeMap<(usize, &str), BTreeSet<String>> = BTreeMap::new();
    let mut owner_of: BTreeMap<String, (usize, &str)> = BTreeMap::new();
    for e in &log {
        let nym = e.presentation.pseudonym.nym();
        let owner = (e.holder, e.presentation.context.as_str());
        by_owner.entry(owner).or_default().insert(nym.clone());
        assert_eq!(*owner_of.entry(nym).or_insert(owner), owner, "nym reused");
    }
    assert!(by_owner.values().all(|s| s.len() == 1));
    let repeats = log.len() - by_owner.len();
    assert!(
        repeats > 0,
        "the run must include repeat actions in a context"
    );

    // What the attacker sees per log entry, and chance for each entry.
    let view: Vec<(Vec<u8>, String, Vec<usize>)> = log
        .iter()
        .map(|e| {
            (
                e.bytes.clone(),
                e.json.clone(),
                anonymity_set(&w.door, &e.presentation),
            )
        })
        .collect();
    for (e, (_, _, set)) in log.iter().zip(&view) {
        assert!(set.contains(&e.holder));
    }
    let chance: Vec<f64> = view.iter().map(|v| 1.0 / v.2.len() as f64).collect();
    let sizes: Vec<usize> = view.iter().map(|v| v.2.len()).collect();
    lines.push(format!(
        "anonymity sets per presentation: min {}, median {}, max {}; {} presentations with a set of 5 or fewer",
        sizes.iter().min().unwrap(),
        {
            let mut s = sizes.clone();
            s.sort_unstable();
            s[s.len() / 2]
        },
        sizes.iter().max().unwrap(),
        sizes.iter().filter(|&&n| n <= 5).count()
    ));

    // Attack 0, attributes only: guess uniformly in the anonymity set. This is the baseline.
    let guesses: Vec<usize> = view
        .iter()
        .map(|v| *v.2.choose(&mut rng).unwrap())
        .collect();
    let attributes = Score::new(
        "attributes only (baseline)",
        &chance,
        guesses.iter().zip(&log).map(|(g, e)| *g == e.holder),
    );

    // Attack 1, exact bytes (rid, u, commitment, signature, Door's entropy, rid scalars).
    let (guesses, hits) = exact_bytes_attack(&w.door, &view, &mut rng);
    assert_eq!(hits, 0, "a presentation contains bytes Door holds");
    let exact = Score::new(
        "Door bytes in presentation",
        &chance,
        guesses.iter().zip(&log).map(|(g, e)| *g == e.holder),
    );

    // Attack 2, byte-pair similarity.
    let guesses = similarity_attack(&w.door, &view, &mut rng);
    let similar = Score::new(
        "Door byte-pair similarity",
        &chance,
        guesses.iter().zip(&log).map(|(g, e)| *g == e.holder),
    );

    // Attack 3, rid in the clear: no presentation carries any form of any rid.
    for r in &w.door {
        let rid_hex = hex::encode(&r.binary[4]);
        assert!(log.iter().all(|e| !e.json.contains(&rid_hex)));
    }

    // Attack 4, Agora alone, proof randomness: no two presentations share an 8-byte run in
    // their proofs (a reused nonce would link a holder's actions across contexts).
    let mut runs: HashMap<&[u8], usize> = HashMap::new();
    let mut shared = 0;
    for (k, e) in log.iter().enumerate() {
        let proof_len = e.bytes.len() - 48;
        for run in e.bytes[..proof_len].windows(8) {
            if let Some(&other) = runs.get(run) {
                if other != k {
                    shared += 1;
                }
            } else {
                runs.insert(run, k);
            }
        }
    }
    assert_eq!(shared, 0, "two presentations share proof bytes");

    // Attack 5, across contexts: for each holder seen in a descendant area, guess which nym in
    // an enclosing area is the same holder, by equal pseudonym or nym, else byte-pair similarity
    // of the presentations, else at random.
    let mut first: BTreeMap<String, &Entry> = BTreeMap::new();
    for e in &log {
        first.entry(e.presentation.pseudonym.nym()).or_insert(e);
    }
    let mut by_context: BTreeMap<&str, Vec<&Entry>> = BTreeMap::new();
    for e in first.values() {
        by_context
            .entry(e.presentation.context.as_str())
            .or_default()
            .push(e);
    }
    let area_path = |c: &str| -> String {
        let e = by_context[c][0];
        e.presentation.disclosed.jurisdiction_path.clone().unwrap()
    };
    let (mut cross_chance, mut cross_hits, mut equal) = (Vec::new(), Vec::new(), 0usize);
    let contexts: Vec<&str> = by_context.keys().copied().collect();
    for &outer in &contexts {
        for &inner in &contexts {
            let (op, ip) = (area_path(outer), area_path(inner));
            if outer == inner || !ip.starts_with(&format!("{op}.")) {
                continue;
            }
            let candidates = &by_context[outer];
            let sets: Vec<Vec<u64>> = candidates.iter().map(|c| grams(&c.bytes)).collect();
            for e in &by_context[inner] {
                let present_outside = candidates.iter().any(|c| c.holder == e.holder);
                cross_chance.push(if present_outside {
                    1.0 / candidates.len() as f64
                } else {
                    0.0
                });
                let same = candidates.iter().position(|c| {
                    c.presentation.pseudonym == e.presentation.pseudonym
                        || c.presentation.pseudonym.nym() == e.presentation.pseudonym.nym()
                });
                let guess = match same {
                    Some(k) => {
                        equal += 1;
                        k
                    }
                    None => {
                        let scores: Vec<usize> =
                            sets.iter().map(|s| shared_grams(s, &e.bytes)).collect();
                        let best = *scores.iter().max().unwrap();
                        let top: Vec<usize> =
                            (0..scores.len()).filter(|&k| scores[k] == best).collect();
                        *top.choose(&mut rng).unwrap()
                    }
                };
                cross_hits.push(candidates[guess].holder == e.holder);
            }
        }
    }
    assert_eq!(equal, 0, "a pseudonym repeats across contexts");
    let cross = Score::new(
        "same holder across contexts",
        &cross_chance,
        cross_hits.into_iter(),
    );

    // Within one context the same holder is linkable by design (one nym per person per area):
    // the equality attack finds every repeat action, which also shows it has teeth.
    let mut within = 0;
    for nyms in by_context.keys() {
        let all: Vec<&Entry> = log
            .iter()
            .filter(|e| e.presentation.context == *nyms)
            .collect();
        for (a, x) in all.iter().enumerate() {
            for y in &all[a + 1..] {
                if x.presentation.pseudonym == y.presentation.pseudonym {
                    within += 1;
                    assert_eq!(x.holder, y.holder);
                }
            }
        }
    }
    assert_eq!(within, repeats);

    // Control: a planted leak (each presentation also carries the credential's signature, as a
    // naive non-zero-knowledge "show the credential" design would). The same attacks must find
    // it, or they prove nothing above.
    let leaky: Vec<(Vec<u8>, String, Vec<usize>)> = log
        .iter()
        .zip(&view)
        .map(|(e, (bytes, json, set))| {
            let sig = hex::decode(&w.credentials[e.holder].signature).unwrap();
            ([bytes.clone(), sig].concat(), json.clone(), set.clone())
        })
        .collect();
    let (guesses, leak_hits) = exact_bytes_attack(&w.door, &leaky, &mut rng);
    let leak_exact = guesses
        .iter()
        .zip(&log)
        .filter(|(g, e)| **g == e.holder)
        .count();
    let guesses = similarity_attack(&w.door, &leaky, &mut rng);
    let leak_similar = guesses
        .iter()
        .zip(&log)
        .filter(|(g, e)| **g == e.holder)
        .count();
    assert_eq!(leak_hits, log.len());
    assert_eq!(leak_exact, log.len());
    assert!(leak_similar * 100 >= log.len() * 95, "{leak_similar}");

    for s in [&attributes, &exact, &similar, &cross] {
        lines.push(s.report());
    }
    lines.push(format!(
        "within one context (by design): {within} of {within} repeat actions linked"
    ));
    lines.push(format!(
        "control, planted leak: exact bytes {leak_exact}/{n}, similarity {leak_similar}/{n}",
        n = log.len()
    ));
    lines.push(format!(
        "time: {built:.1} s to enrol and present, {:.1} s total",
        started.elapsed().as_secs_f64()
    ));
    eprintln!("{}", lines.join("\n"));
    for s in [&attributes, &exact, &similar, &cross] {
        s.assert_chance();
    }
}

#[test]
fn charter_residence_covers_every_listed_resident() {
    // The population model the harness uses: every Charter jurisdiction with residents of its
    // own, 200 enrolees in proportion. Small areas get very few enrolees; that is the point.
    let table = charter_residence();
    let paths = allocate(&table, ENROLEES);
    assert_eq!(paths.len(), ENROLEES);
    assert!(table.iter().all(|(p, _)| p.starts_with("lu.")));
    let vianden = paths
        .iter()
        .filter(|p| p.as_str() == "lu.lu-canton-vianden")
        .count();
    assert!((1..=3).contains(&vianden), "{vianden}");
}

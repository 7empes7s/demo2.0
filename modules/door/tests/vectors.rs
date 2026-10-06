//! Drift test: the committed vectors in spec/door/ must still check against this code, and
//! regenerating them must give the same deterministic parts and the same case list.

use d2_door::vectors::{check, generate, Vectors, SCHEMA};
use std::path::PathBuf;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/door/vectors.json")
}

fn load() -> Vectors {
    let text = std::fs::read_to_string(vectors_path()).expect("spec/door/vectors.json exists");
    serde_json::from_str(&text).expect("vectors parse")
}

#[test]
fn committed_vectors_check() {
    let v = load();
    assert_eq!(v.schema, SCHEMA);
    let n = check(&v).unwrap();
    assert!(n >= 30, "{n} checks");
}

#[test]
fn regenerated_vectors_match_committed_deterministic_parts() {
    let committed = load();
    let fresh = generate().unwrap();
    assert_eq!(fresh.seeds, committed.seeds);
    assert_eq!(fresh.issuer_keys, committed.issuer_keys);
    assert_eq!(fresh.uniqueness, committed.uniqueness);
    assert_eq!(fresh.second_enrolment, committed.second_enrolment);
    assert_eq!(fresh.ciphersuite, committed.ciphersuite);
    assert_eq!(fresh.drafts, committed.drafts);
    assert_eq!(fresh.credential_header, committed.credential_header);
    assert_eq!(
        fresh.generated_by, committed.generated_by,
        "version in generated_by"
    );
    // The case list (names, notes, expectations) is part of the format.
    let shape = |v: &Vectors| {
        v.presentations
            .iter()
            .map(|c| {
                (
                    c.name.clone(),
                    c.note.clone(),
                    c.holder.clone(),
                    c.context.clone(),
                    c.required,
                    c.expect.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(shape(&fresh), shape(&committed));
    let pseudonym_shape = |v: &Vectors| {
        v.pseudonyms
            .iter()
            .map(|p| (p.holder.clone(), p.context.clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(pseudonym_shape(&fresh), pseudonym_shape(&committed));
    // The committed file is the pretty JSON of its own parse (no hand edits that drift).
    let text = std::fs::read_to_string(vectors_path()).unwrap();
    assert_eq!(
        text,
        serde_json::to_string_pretty(&committed).unwrap() + "\n"
    );
}

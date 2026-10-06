//! Drift test: the committed vectors in spec/booth/ must check against this code and must be
//! exactly what this code regenerates (the whole round is deterministic from the public seed).

use d2_booth::vectors::{check, generate, Vectors, SCHEMA};
use std::path::PathBuf;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/booth/vectors.json")
}

fn load() -> Vectors {
    let text = std::fs::read_to_string(vectors_path()).expect("spec/booth/vectors.json exists");
    serde_json::from_str(&text).expect("vectors parse")
}

#[test]
fn committed_vectors_check() {
    let v = load();
    assert_eq!(v.schema, SCHEMA);
    let n = check(&v).unwrap();
    assert_eq!(n, 1 + v.must_fail.len());
    assert!(
        v.must_fail.len() >= 20,
        "{} must-fail cases",
        v.must_fail.len()
    );
}

#[test]
fn regenerated_vectors_equal_committed() {
    let committed = load();
    let fresh = generate().unwrap();
    assert_eq!(
        fresh, committed,
        "regenerate with `d2-booth vectors --out spec/booth/vectors.json`"
    );
    let text = std::fs::read_to_string(vectors_path()).unwrap();
    assert_eq!(
        text,
        serde_json::to_string_pretty(&committed).unwrap() + "\n",
        "the committed file is the pretty JSON of its own parse"
    );
}

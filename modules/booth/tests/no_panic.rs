//! The verifier takes boards from anyone. Random bytes, random JSON and every field of a real
//! board replaced by every JSON type must come back as an error, never a panic.

use d2_booth::vectors::{mutate, Mutation, Vectors};
use d2_booth::{verify_board, Board};
use rand::rngs::StdRng;
use rand::{Rng, RngCore, SeedableRng};
use serde_json::{json, Value};
use std::path::PathBuf;

fn vectors() -> Vectors {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/booth/vectors.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// Every JSON pointer to a leaf or container inside a value.
fn pointers(v: &Value, prefix: &str, out: &mut Vec<String>) {
    out.push(prefix.to_string());
    match v {
        Value::Object(m) => {
            for (k, child) in m {
                pointers(child, &format!("{prefix}/{k}"), out);
            }
        }
        Value::Array(items) => {
            for (i, child) in items.iter().enumerate() {
                pointers(child, &format!("{prefix}/{i}"), out);
            }
        }
        _ => {}
    }
}

fn junk_values(rng: &mut StdRng) -> Vec<Value> {
    let mut bytes = vec![0u8; rng.gen_range(0..80)];
    rng.fill_bytes(&mut bytes);
    let hex_len = [0usize, 1, 31, 32, 33, 63, 64, 65][rng.gen_range(0..8)];
    let mut hex_bytes = vec![0u8; hex_len];
    rng.fill_bytes(&mut hex_bytes);
    vec![
        Value::Null,
        json!(true),
        json!(0),
        json!(-1),
        json!(u64::MAX),
        json!(1.5),
        json!(""),
        json!(hex::encode(&hex_bytes)),
        json!(hex::encode(&hex_bytes).to_uppercase()),
        json!(String::from_utf8_lossy(&bytes)),
        json!([]),
        json!([json!(hex::encode(&hex_bytes))]),
        json!({}),
        json!({"a": 1}),
    ]
}

#[test]
fn every_field_replaced_by_every_json_type_is_an_error_not_a_panic() {
    let v = vectors();
    let mut rng = StdRng::seed_from_u64(99);
    let mut checks = 0usize;
    // One entry per kind is enough: entries of a kind share a shape. Values of every JSON
    // type go in with the chain rehashed (so the protocol code sees them) and, for a sample,
    // without (so the chain code sees them).
    let mut seen = std::collections::BTreeSet::new();
    for (seq, entry) in v.board.entries.iter().enumerate() {
        if !seen.insert(entry.kind.clone()) {
            continue;
        }
        let mut ptrs = Vec::new();
        pointers(&serde_json::to_value(entry).unwrap(), "", &mut ptrs);
        for pointer in ptrs.iter().filter(|p| !p.is_empty()) {
            for (i, value) in junk_values(&mut rng).into_iter().enumerate() {
                for rehash in if i % 5 == 0 {
                    vec![false, true]
                } else {
                    vec![true]
                } {
                    let m = Mutation::Set {
                        seq: seq as u64,
                        pointer: pointer.clone(),
                        value: value.clone(),
                        rehash,
                    };
                    let Ok(board) = mutate(&v.board, &m) else {
                        continue;
                    };
                    // A mutation that leaves the board valid is fine (e.g. a label); a
                    // panic is not.
                    let _ = verify_board(&board);
                    checks += 1;
                }
            }
        }
    }
    assert!(checks > 1_000, "{checks} checks");
}

#[test]
fn random_bytes_and_random_json_are_errors() {
    let mut rng = StdRng::seed_from_u64(100);
    for _ in 0..300 {
        let mut bytes = vec![0u8; rng.gen_range(0..400)];
        rng.fill_bytes(&mut bytes);
        if let Ok(board) = serde_json::from_slice::<Board>(&bytes) {
            assert!(verify_board(&board).is_err());
        }
    }
    for text in [
        "{}",
        "[]",
        "null",
        r#"{"schema":"d2.booth.board/1","entries":[]}"#,
        r#"{"schema":"d2.booth.board/1","entries":[{}]}"#,
        r#"{"schema":"d2.booth.board/1","entries":[{"seq":0,"prev":"","kind":"","payload":null,"hash":""}]}"#,
        r#"{"schema":"d2.booth.board/1","entries":[{"seq":0,"prev":"0000000000000000000000000000000000000000000000000000000000000000","kind":"round.params","payload":{"schema":"d2.booth.round/1","round_id":"r","matter_id":"m","options":["a","b"],"guardians":1,"threshold":1},"hash":"0000000000000000000000000000000000000000000000000000000000000000"}]}"#,
    ] {
        if let Ok(board) = serde_json::from_str::<Board>(text) {
            assert!(verify_board(&board).is_err(), "{text}");
        }
    }
}

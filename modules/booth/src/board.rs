//! The public bulletin board: an append-only, hash-chained list of entries.
//!
//! Entry hash: `SHA-256("d2.booth.entry/1" || 0x00 || seq as 8 bytes big-endian || prev (32
//! bytes) || kind || 0x00 || canonical JSON of payload)`. `prev` of entry 0 is 32 zero bytes.
//! Canonical JSON: object keys sorted by byte value, no whitespace, unsigned integers only (no
//! floats, negatives, booleans or null), strings escaped as serde_json does (`"`, `\`, control
//! characters; everything else raw UTF-8). Board files with a duplicate object key are refused
//! by `parse_board` before anything is hashed.

use crate::error::BoothError;
use crate::wire::BOARD_SCHEMA;
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

/// Domain separator of entry hashes.
pub const ENTRY_DOMAIN: &[u8] = b"d2.booth.entry/1";

/// One board entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    /// Position, from 0.
    pub seq: u64,
    /// Hash of the previous entry, hex (zeros for entry 0).
    pub prev: String,
    /// Entry kind (`wire::kind`).
    pub kind: String,
    /// The payload (one of the `wire` structs).
    pub payload: Value,
    /// This entry's hash, hex.
    pub hash: String,
}

/// The board as published.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Board {
    /// `d2.booth.board/1`.
    pub schema: String,
    /// Entries in order.
    pub entries: Vec<Entry>,
}

impl Default for Board {
    fn default() -> Self {
        Self::new()
    }
}

impl Board {
    /// An empty board.
    pub fn new() -> Self {
        Self {
            schema: BOARD_SCHEMA.to_string(),
            entries: Vec::new(),
        }
    }

    /// Hash of the last entry (zeros when empty), hex.
    pub fn head(&self) -> String {
        self.entries
            .last()
            .map(|e| e.hash.clone())
            .unwrap_or_else(|| hex::encode([0u8; 32]))
    }

    /// Append a payload under `kind`, chaining it to the head. Returns the new entry.
    pub fn append<T: Serialize>(&mut self, kind: &str, payload: &T) -> Result<&Entry, BoothError> {
        let payload = serde_json::to_value(payload)
            .map_err(|e| BoothError::Malformed(format!("payload: {e}")))?;
        let seq = self.entries.len() as u64;
        let prev = self.head();
        let hash = entry_hash(seq, &prev, kind, &payload)?;
        self.entries.push(Entry {
            seq,
            prev,
            kind: kind.to_string(),
            payload,
            hash,
        });
        Ok(self.entries.last().expect("just pushed"))
    }

    /// Check the schema, the sequence numbers and the hash chain. Nothing about the protocol.
    pub fn verify_chain(&self) -> Result<(), BoothError> {
        if self.schema != BOARD_SCHEMA {
            return Err(BoothError::Malformed(format!("schema: {}", self.schema)));
        }
        let mut prev = hex::encode([0u8; 32]);
        for (i, e) in self.entries.iter().enumerate() {
            let seq = i as u64;
            if e.seq != seq || e.prev != prev {
                return Err(BoothError::ChainBroken(seq));
            }
            let expected = entry_hash(seq, &prev, &e.kind, &e.payload)?;
            if expected != e.hash {
                return Err(BoothError::ChainBroken(seq));
            }
            prev = e.hash.clone();
        }
        Ok(())
    }
}

/// Hash of one entry, hex.
pub fn entry_hash(seq: u64, prev: &str, kind: &str, payload: &Value) -> Result<String, BoothError> {
    let prev_bytes = crate::group::hex_bytes("prev", prev, 32)?;
    if kind.is_empty() || kind.bytes().any(|b| b == 0 || !b.is_ascii_graphic()) {
        return Err(BoothError::Malformed("kind".to_string()));
    }
    let mut h = Sha256::new();
    h.update(ENTRY_DOMAIN);
    h.update([0u8]);
    h.update(seq.to_be_bytes());
    h.update(&prev_bytes);
    h.update(kind.as_bytes());
    h.update([0u8]);
    h.update(canonical(payload)?.as_bytes());
    Ok(hex::encode(h.finalize()))
}

/// Parse a board file, refusing JSON with a duplicate object key anywhere (a plain parse keeps
/// the last value silently, so two readers could disagree on what was hashed).
pub fn parse_board(text: &str) -> Result<Board, BoothError> {
    serde_json::from_str::<NoDuplicateKeys>(text)
        .map_err(|e| BoothError::Malformed(format!("board JSON: {e}")))?;
    serde_json::from_str(text).map_err(|e| BoothError::Malformed(format!("board JSON: {e}")))
}

/// Walks any JSON value and fails on the first object with a repeated key.
struct NoDuplicateKeys;

impl<'de> Deserialize<'de> for NoDuplicateKeys {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(NoDuplicateKeysVisitor)
    }
}

struct NoDuplicateKeysVisitor;

impl<'de> Visitor<'de> for NoDuplicateKeysVisitor {
    type Value = NoDuplicateKeys;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("any JSON value")
    }
    fn visit_bool<E>(self, _: bool) -> Result<Self::Value, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_i64<E>(self, _: i64) -> Result<Self::Value, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_u64<E>(self, _: u64) -> Result<Self::Value, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_f64<E>(self, _: f64) -> Result<Self::Value, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_str<E>(self, _: &str) -> Result<Self::Value, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        while seq.next_element::<NoDuplicateKeys>()?.is_some() {}
        Ok(NoDuplicateKeys)
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut keys = HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if !keys.insert(key.clone()) {
                return Err(de::Error::custom(format!("duplicate key {key:?}")));
            }
            map.next_value::<NoDuplicateKeys>()?;
        }
        Ok(NoDuplicateKeys)
    }
}

/// Canonical JSON of a value: sorted keys, compact, unsigned integers, strings, arrays and
/// objects only.
pub fn canonical(v: &Value) -> Result<String, BoothError> {
    let mut out = String::new();
    write_canonical(v, &mut out)?;
    Ok(out)
}

fn write_canonical(v: &Value, out: &mut String) -> Result<(), BoothError> {
    match v {
        Value::Null | Value::Bool(_) => {
            return Err(BoothError::Malformed(
                "canonical JSON has no null or booleans".to_string(),
            ))
        }
        Value::Number(n) => match n.as_u64() {
            Some(u) => out.push_str(&u.to_string()),
            None => {
                return Err(BoothError::Malformed(
                    "canonical JSON has unsigned integers only".to_string(),
                ))
            }
        },
        Value::String(s) => out
            .push_str(&serde_json::to_string(s).map_err(|e| BoothError::Malformed(e.to_string()))?),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(
                    &serde_json::to_string(k).map_err(|e| BoothError::Malformed(e.to_string()))?,
                );
                out.push(':');
                write_canonical(&map[*k], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// Parse an entry's payload as `T`, refusing unknown fields.
pub fn payload<T: for<'de> Deserialize<'de>>(entry: &Entry) -> Result<T, BoothError> {
    serde_json::from_value(entry.payload.clone())
        .map_err(|e| BoothError::Malformed(format!("entry {} ({}): {e}", entry.seq, entry.kind)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_sorts_keys_and_is_compact() {
        let v = json!({"b": [1, 2, {"z": "x\"y", "a": "q"}], "a": 18446744073709551615u64});
        assert_eq!(
            canonical(&v).unwrap(),
            r#"{"a":18446744073709551615,"b":[1,2,{"a":"q","z":"x\"y"}]}"#
        );
    }

    #[test]
    fn canonical_refuses_what_payloads_never_hold() {
        for v in [
            json!({"x": 1.5}),
            json!({"x": -1}),
            json!({"x": null}),
            json!({"x": [true]}),
            json!(false),
        ] {
            assert!(canonical(&v).is_err(), "{v}");
        }
    }

    #[test]
    fn duplicate_keys_are_refused_before_hashing() {
        let mut b = Board::new();
        b.append("a", &json!({"x": 1})).unwrap();
        let text = serde_json::to_string(&b).unwrap();
        assert_eq!(parse_board(&text).unwrap(), b);
        let dup = text.replace(r#"{"x":1}"#, r#"{"x":2,"x":1}"#);
        assert_ne!(dup, text);
        // A plain parse keeps the last value and the chain still verifies; parse_board refuses.
        let plain: Board = serde_json::from_str(&dup).unwrap();
        plain.verify_chain().unwrap();
        assert!(matches!(parse_board(&dup), Err(BoothError::Malformed(_))));
        let dup_top = text.replacen(r#""schema""#, r#""schema":"x","schema""#, 1);
        assert!(matches!(
            parse_board(&dup_top),
            Err(BoothError::Malformed(_))
        ));
    }

    #[test]
    fn chain_detects_edits() {
        let mut b = Board::new();
        b.append("a", &json!({"x": 1})).unwrap();
        b.append("b", &json!({"y": 2})).unwrap();
        b.verify_chain().unwrap();
        let mut t = b.clone();
        t.entries[0].payload = json!({"x": 2});
        assert_eq!(t.verify_chain(), Err(BoothError::ChainBroken(0)));
        let mut t = b.clone();
        t.entries.remove(0);
        assert_eq!(t.verify_chain(), Err(BoothError::ChainBroken(0)));
        let mut t = b.clone();
        t.entries[1].kind = "c".to_string();
        assert_eq!(t.verify_chain(), Err(BoothError::ChainBroken(1)));
    }
}

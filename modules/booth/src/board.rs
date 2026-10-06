//! The public bulletin board: an append-only, hash-chained list of entries.
//!
//! Entry hash: `SHA-256("d2.booth.entry/1" || 0x00 || seq as 8 bytes big-endian || prev (32
//! bytes) || kind || 0x00 || canonical JSON of payload)`. `prev` of entry 0 is 32 zero bytes.
//! Canonical JSON: object keys sorted by byte value, no whitespace, integers only (no floats),
//! strings escaped as serde_json does (`"`, `\`, control characters; everything else raw UTF-8).

use crate::error::BoothError;
use crate::wire::BOARD_SCHEMA;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

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

/// Canonical JSON of a value: sorted keys, compact, integers only.
pub fn canonical(v: &Value) -> Result<String, BoothError> {
    let mut out = String::new();
    write_canonical(v, &mut out)?;
    Ok(out)
}

fn write_canonical(v: &Value, out: &mut String) -> Result<(), BoothError> {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else {
                return Err(BoothError::Malformed(
                    "canonical JSON has no floats".to_string(),
                ));
            }
        }
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
        let v = json!({"b": [1, 2, {"z": "x\"y", "a": null}], "a": true});
        assert_eq!(
            canonical(&v).unwrap(),
            r#"{"a":true,"b":[1,2,{"a":null,"z":"x\"y"}]}"#
        );
    }

    #[test]
    fn canonical_refuses_floats() {
        assert!(canonical(&json!({"x": 1.5})).is_err());
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

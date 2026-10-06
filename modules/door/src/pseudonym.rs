//! Per-context pseudonyms.
//!
//! The BBS per-verifier-linkability draft computes `pseudonym = OP * nym_secret` where
//! `OP = hash_to_curve(context_id)` is a G1 point and `nym_secret` is the holder's signed secret.
//! Same holder and same context give the same point; across contexts the points are unlinkable
//! under the decisional Diffie-Hellman assumption in G1. Door publishes the point's compressed
//! encoding (48 bytes) and a short text form for the modules that consume it.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;

/// A per-context pseudonym: the compressed G1 point from the BBS pseudonym proof.
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Pseudonym {
    /// Lowercase hex of the 48-byte compressed point.
    point: String,
}

impl Pseudonym {
    /// Wrap the compressed point bytes.
    pub fn from_point_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != 48 {
            return Err(format!(
                "pseudonym point must be 48 bytes, got {}",
                bytes.len()
            ));
        }
        Ok(Self {
            point: hex::encode(bytes),
        })
    }

    /// Parse the hex form.
    pub fn from_hex(hex_point: &str) -> Result<Self, String> {
        let bytes = hex::decode(hex_point).map_err(|e| e.to_string())?;
        if hex::encode(&bytes) != hex_point {
            return Err("pseudonym hex must be lowercase".to_string());
        }
        Self::from_point_bytes(&bytes)
    }

    /// The compressed point, 48 bytes.
    pub fn point_bytes(&self) -> Vec<u8> {
        hex::decode(&self.point).expect("pseudonym holds valid hex")
    }

    /// Lowercase hex of the point.
    pub fn as_hex(&self) -> &str {
        &self.point
    }

    /// Short text form for the modules that consume pseudonyms:
    /// `nym-` + the first 26 characters of lowercase base32(SHA-256(point)).
    /// This is the shape Agora's `KeyedNyms` stand-in already produces, so the modules that
    /// store nyms need no schema change when Door replaces it.
    pub fn nym(&self) -> String {
        let digest = Sha256::digest(self.point_bytes());
        let mut text = base32_lower(&digest);
        text.truncate(26);
        format!("nym-{text}")
    }
}

impl fmt::Debug for Pseudonym {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Pseudonym({})", self.nym())
    }
}

impl fmt::Display for Pseudonym {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.nym())
    }
}

/// RFC 4648 base32, lowercase alphabet, no padding. Encoding only; not a cryptographic step.
fn base32_lower(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for &b in bytes {
        buffer = (buffer << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base32_matches_rfc4648_vectors() {
        // RFC 4648 section 10, lowercased and unpadded.
        assert_eq!(base32_lower(b""), "");
        assert_eq!(base32_lower(b"f"), "my");
        assert_eq!(base32_lower(b"fo"), "mzxq");
        assert_eq!(base32_lower(b"foo"), "mzxw6");
        assert_eq!(base32_lower(b"foob"), "mzxw6yq");
        assert_eq!(base32_lower(b"fooba"), "mzxw6ytb");
        assert_eq!(base32_lower(b"foobar"), "mzxw6ytboi");
    }

    #[test]
    fn nym_shape() {
        let p = Pseudonym::from_point_bytes(&[7u8; 48]).unwrap();
        let nym = p.nym();
        assert_eq!(nym.len(), 30);
        assert!(nym.starts_with("nym-"));
        assert!(nym[4..]
            .bytes()
            .all(|b| b.is_ascii_lowercase() || (b'2'..=b'7').contains(&b)));
        assert_eq!(Pseudonym::from_hex(p.as_hex()).unwrap(), p);
        assert!(Pseudonym::from_point_bytes(&[0u8; 47]).is_err());
        assert!(Pseudonym::from_hex(&"0A".repeat(48)).is_err());
    }
}

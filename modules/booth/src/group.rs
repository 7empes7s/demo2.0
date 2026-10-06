//! Group helpers over ristretto255: hex encoding, Fiat-Shamir transcripts, Chaum-Pedersen
//! proofs. All curve arithmetic is `curve25519-dalek`; nothing here touches field elements.

use crate::error::BoothError;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT;
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::{Identity, VartimeMultiscalarMul};
use merlin::Transcript;
use rand::{CryptoRng, RngCore};
use serde::{Deserialize, Serialize};

/// Protocol label every transcript starts with.
pub const PROTOCOL: &[u8] = b"d2.booth/1";

/// The group generator `G`.
pub fn g() -> RistrettoPoint {
    RISTRETTO_BASEPOINT_POINT
}

/// Lowercase hex of a compressed point (32 bytes).
pub fn point_hex(p: &RistrettoPoint) -> String {
    hex::encode(p.compress().as_bytes())
}

/// Lowercase hex of a scalar (32 bytes, little endian, canonical).
pub fn scalar_hex(s: &Scalar) -> String {
    hex::encode(s.as_bytes())
}

/// Decode exactly `len` bytes of lowercase hex; anything else is `Malformed(field)`.
pub fn hex_bytes(field: &str, text: &str, len: usize) -> Result<Vec<u8>, BoothError> {
    if text.len() != len * 2
        || text
            .bytes()
            .any(|b| !matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(BoothError::Malformed(format!(
            "{field}: expected {len} bytes of lowercase hex"
        )));
    }
    hex::decode(text).map_err(|_| BoothError::Malformed(field.to_string()))
}

/// Parse a point from 32 bytes of hex. The identity is refused everywhere a point is read
/// from the board: no honest party ever publishes it and it would make proofs degenerate.
pub fn point(field: &str, text: &str) -> Result<RistrettoPoint, BoothError> {
    let bytes = hex_bytes(field, text, 32)?;
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    let p = CompressedRistretto(arr)
        .decompress()
        .ok_or_else(|| BoothError::Malformed(format!("{field}: not a ristretto255 point")))?;
    if p == RistrettoPoint::identity() {
        return Err(BoothError::Malformed(format!("{field}: identity point")));
    }
    Ok(p)
}

/// Parse a canonical scalar from 32 bytes of hex.
pub fn scalar(field: &str, text: &str) -> Result<Scalar, BoothError> {
    let bytes = hex_bytes(field, text, 32)?;
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Option::<Scalar>::from(Scalar::from_canonical_bytes(arr))
        .ok_or_else(|| BoothError::Malformed(format!("{field}: non-canonical scalar")))
}

/// A fresh transcript for one proof. `kind` says which proof; the round id binds it to the
/// round. Every proof in Booth starts exactly like this, so an independent verifier can
/// rebuild the challenge.
pub fn transcript(kind: &'static [u8], round_id: &str) -> Transcript {
    let mut t = Transcript::new(PROTOCOL);
    t.append_message(b"kind", kind);
    t.append_message(b"round_id", round_id.as_bytes());
    t
}

/// Append a point under a label.
pub fn append_point(t: &mut Transcript, label: &'static [u8], p: &RistrettoPoint) {
    t.append_message(label, p.compress().as_bytes());
}

/// Append an unsigned integer under a label (little-endian 8 bytes, as merlin's `append_u64`).
pub fn append_u64(t: &mut Transcript, label: &'static [u8], n: u64) {
    t.append_u64(label, n);
}

/// Draw a challenge scalar: 64 transcript bytes reduced modulo the group order.
pub fn challenge(t: &mut Transcript, label: &'static [u8]) -> Scalar {
    let mut buf = [0u8; 64];
    t.challenge_bytes(label, &mut buf);
    Scalar::from_bytes_mod_order_wide(&buf)
}

/// A random non-zero scalar.
pub fn random_scalar<R: RngCore + CryptoRng>(rng: &mut R) -> Scalar {
    loop {
        let s = Scalar::random(rng);
        if s != Scalar::ZERO {
            return s;
        }
    }
}

/// Chaum-Pedersen proof that `(a, b) = (x·G1, x·G2)` for a known `x`, on the wire.
///
/// Verification: `v·G1 == A + c·a`, `v·G2 == B + c·b`, `c` recomputed from the transcript
/// after `A` and `B` are appended as `commit_1`, `commit_2`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChaumPedersen {
    /// `A = w·G1`, hex.
    pub commit_1: String,
    /// `B = w·G2`, hex.
    pub commit_2: String,
    /// Response `v = w + c·x`, hex.
    pub response: String,
}

impl ChaumPedersen {
    /// Prove with the caller's prepared transcript (the statement must already be in it).
    pub fn prove<R: RngCore + CryptoRng>(
        t: &mut Transcript,
        g1: &RistrettoPoint,
        g2: &RistrettoPoint,
        x: &Scalar,
        rng: &mut R,
    ) -> Self {
        let w = random_scalar(rng);
        let a = w * g1;
        let b = w * g2;
        append_point(t, b"commit_1", &a);
        append_point(t, b"commit_2", &b);
        let c = challenge(t, b"challenge");
        Self {
            commit_1: point_hex(&a),
            commit_2: point_hex(&b),
            response: scalar_hex(&(w + c * x)),
        }
    }

    /// Verify against the statement `(a, b)` under `(g1, g2)`.
    pub fn verify(
        &self,
        t: &mut Transcript,
        g1: &RistrettoPoint,
        g2: &RistrettoPoint,
        a: &RistrettoPoint,
        b: &RistrettoPoint,
    ) -> Result<(), BoothError> {
        let ca = point("commit_1", &self.commit_1)?;
        let cb = point("commit_2", &self.commit_2)?;
        let v = scalar("response", &self.response)?;
        append_point(t, b"commit_1", &ca);
        append_point(t, b"commit_2", &cb);
        let c = challenge(t, b"challenge");
        let ok1 = RistrettoPoint::vartime_multiscalar_mul([v, -c], [g1, a]) == ca;
        let ok2 = RistrettoPoint::vartime_multiscalar_mul([v, -c], [g2, b]) == cb;
        if ok1 && ok2 {
            Ok(())
        } else {
            Err(BoothError::ProofFailed)
        }
    }
}

/// Schnorr proof of knowledge of `x` with `P = x·G` (used for each guardian's constant term).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schnorr {
    /// `A = w·G`, hex.
    pub commit: String,
    /// `v = w + c·x`, hex.
    pub response: String,
}

impl Schnorr {
    /// Prove knowledge of `x` for `P = x·G` with the statement already in the transcript.
    pub fn prove<R: RngCore + CryptoRng>(t: &mut Transcript, x: &Scalar, rng: &mut R) -> Self {
        let w = random_scalar(rng);
        let a = w * g();
        append_point(t, b"commit", &a);
        let c = challenge(t, b"challenge");
        Self {
            commit: point_hex(&a),
            response: scalar_hex(&(w + c * x)),
        }
    }

    /// Verify for the public point `p`.
    pub fn verify(&self, t: &mut Transcript, p: &RistrettoPoint) -> Result<(), BoothError> {
        let a = point("commit", &self.commit)?;
        let v = scalar("response", &self.response)?;
        append_point(t, b"commit", &a);
        let c = challenge(t, b"challenge");
        if RistrettoPoint::vartime_multiscalar_mul([v, -c], [&g(), p]) == a {
            Ok(())
        } else {
            Err(BoothError::ProofFailed)
        }
    }
}

/// Lagrange coefficient at zero for guardian `j` among the distinct, non-zero indices `set`.
pub fn lagrange_at_zero(j: u32, set: &[u32]) -> Result<Scalar, BoothError> {
    let mut num = Scalar::ONE;
    let mut den = Scalar::ONE;
    for &m in set {
        if m == j {
            continue;
        }
        num *= Scalar::from(m);
        // m - j, as a scalar: distinct indices so never zero.
        den *= Scalar::from(m) - Scalar::from(j);
    }
    if den == Scalar::ZERO {
        return Err(BoothError::Malformed(
            "duplicate guardian index in decryption set".to_string(),
        ));
    }
    Ok(num * den.invert())
}

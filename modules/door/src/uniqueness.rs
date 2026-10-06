//! Uniqueness: one credential per person per epoch, without storing who the person is.
//!
//! `u = OPRF_K(person_id)` (02-protocols section 1, step 3) is computed with the RFC 9497 OPRF
//! over ristretto255 (`voprf` crate). Door stores `u → epoch` and nothing about the person.
//! Because a Luxembourg national id is structured and enumerable, `u` is only as private as
//! `K`: the protocol wants `K` split k-of-n between independent holders. v1 holds a single key
//! (the documented Phase 5 upgrade). The blinded evaluation path, which lets a key holder
//! other than Door hold `K`, is in the crate so the threshold version has somewhere to go, and a
//! test checks it agrees with the direct evaluation.

use rand::{CryptoRng, RngCore};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;
use voprf::{OprfClient, OprfServer, Ristretto255};

/// Domain separation for the OPRF input, so a `u` can never collide with another use of the
/// same identifier.
const INPUT_PREFIX: &[u8] = b"d2.door.person/1\0";
/// Info string for deriving the OPRF key from a seed (RFC 9497 DeriveKeyPair).
const KEY_INFO: &[u8] = b"d2.door.uniqueness/1";

/// The OPRF key `K` and the operations Door runs with it.
pub struct UniquenessKey {
    server: OprfServer<Ristretto255>,
}

impl UniquenessKey {
    /// Draw a fresh key.
    pub fn generate<R: RngCore + CryptoRng>(rng: &mut R) -> Self {
        let mut seed = [0u8; 32];
        rng.fill_bytes(&mut seed);
        Self::from_seed(seed)
    }

    /// Derive the key from a 32-byte seed (the seed is the secret; keep it in a 600-mode file,
    /// never in git). Deterministic, so a restarted Door computes the same `u`.
    pub fn from_seed(seed: [u8; 32]) -> Self {
        let server = OprfServer::<Ristretto255>::new_from_seed(&seed, KEY_INFO)
            .expect("ristretto255 OPRF key derivation cannot fail for a 32-byte seed");
        Self { server }
    }

    /// `u = OPRF_K(person_id)`: 64 bytes (SHA-512 output of the ristretto255 suite), hex.
    pub fn uniqueness_key(&self, person_id: &str) -> String {
        let output = self
            .server
            .evaluate(&input(person_id))
            .expect("OPRF input is far below the 65535-byte limit");
        hex::encode(output)
    }

    /// The server half of the blinded path: evaluate a client's blinded element. This is what a
    /// separate key holder would run; Door itself does not need it while it holds `K`.
    pub fn blind_evaluate(&self, blinded: &[u8]) -> Result<Vec<u8>, String> {
        let element = voprf::BlindedElement::<Ristretto255>::deserialize(blinded)
            .map_err(|e| format!("blinded element: {e}"))?;
        Ok(self.server.blind_evaluate(&element).serialize().to_vec())
    }
}

/// The client half of the blinded path, in two steps. `blind` hides `person_id` from the key
/// holder; `finalize` recovers `u` from the holder's answer. The result equals
/// [`UniquenessKey::uniqueness_key`].
pub struct BlindedPerson {
    input: Vec<u8>,
    client: OprfClient<Ristretto255>,
    /// Serialised blinded element to send to the key holder.
    pub blinded: Vec<u8>,
}

impl BlindedPerson {
    /// Blind a person id.
    pub fn blind<R: RngCore + CryptoRng>(person_id: &str, rng: &mut R) -> Self {
        let input = input(person_id);
        let result = OprfClient::<Ristretto255>::blind(&input, rng)
            .expect("blinding cannot fail for a short input");
        Self {
            input,
            client: result.state,
            blinded: result.message.serialize().to_vec(),
        }
    }

    /// Unblind the key holder's answer into `u` (hex).
    pub fn finalize(self, evaluated: &[u8]) -> Result<String, String> {
        let element = voprf::EvaluationElement::<Ristretto255>::deserialize(evaluated)
            .map_err(|e| format!("evaluation element: {e}"))?;
        let output = self
            .client
            .finalize(&self.input, &element)
            .map_err(|e| format!("finalize: {e}"))?;
        Ok(hex::encode(output))
    }
}

fn input(person_id: &str) -> Vec<u8> {
    let mut v = INPUT_PREFIX.to_vec();
    v.extend_from_slice(person_id.as_bytes());
    v
}

/// What Door keeps per enrolment (03-data-model `UniquenessEntry`). Never leaves Door.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UniquenessEntry {
    /// `u`, hex.
    pub oprf_key_u: String,
    /// The epoch the credential was issued in.
    pub epoch: u32,
    /// The revocation handle `rid`, hex. **v1 stores it in the clear.** The protocol wants it
    /// encrypted to a threshold key `T` (`Enc_T(rid)`) so that revoking one person takes k-of-n
    /// holders; that escrow is not built yet. Knowing `rid` links nothing: it never appears in
    /// a presentation.
    pub revocation_handle: String,
}

/// Second enrolment for the same `u` in the same epoch.
#[derive(Debug, Error, PartialEq, Eq)]
#[error("already enrolled in epoch {epoch}")]
pub struct AlreadyEnrolled {
    /// The epoch.
    pub epoch: u32,
}

/// Storage for [`UniquenessEntry`] rows. One row per `(u, epoch)`; inserting a second is an
/// error, which is the whole sybil check.
pub trait UniquenessStore {
    /// Is `u` enrolled in `epoch`?
    fn has(&self, u: &str, epoch: u32) -> bool;
    /// Insert, refusing a duplicate `(u, epoch)`.
    fn insert(&mut self, entry: UniquenessEntry) -> Result<(), AlreadyEnrolled>;
    /// Number of entries in an epoch (published per commune per day in the full system).
    fn count(&self, epoch: u32) -> usize;
}

/// In-memory store for tests and the demo. A real deployment needs a durable one.
#[derive(Debug, Default, Clone)]
pub struct MemoryStore {
    rows: BTreeMap<(String, u32), UniquenessEntry>,
}

impl MemoryStore {
    /// Empty store.
    pub fn new() -> Self {
        Self::default()
    }
}

impl UniquenessStore for MemoryStore {
    fn has(&self, u: &str, epoch: u32) -> bool {
        self.rows.contains_key(&(u.to_string(), epoch))
    }

    fn insert(&mut self, entry: UniquenessEntry) -> Result<(), AlreadyEnrolled> {
        let key = (entry.oprf_key_u.clone(), entry.epoch);
        if self.rows.contains_key(&key) {
            return Err(AlreadyEnrolled { epoch: entry.epoch });
        }
        self.rows.insert(key, entry);
        Ok(())
    }

    fn count(&self, epoch: u32) -> usize {
        self.rows.keys().filter(|(_, e)| *e == epoch).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_and_blinded_evaluation_agree() {
        let key = UniquenessKey::from_seed([3u8; 32]);
        let direct = key.uniqueness_key("test-person-0001");
        assert_eq!(direct.len(), 128);
        let blinded = BlindedPerson::blind("test-person-0001", &mut rand::rngs::OsRng);
        let answer = key.blind_evaluate(&blinded.blinded).unwrap();
        assert_eq!(blinded.finalize(&answer).unwrap(), direct);
        assert_ne!(key.uniqueness_key("test-person-0002"), direct);
        assert_ne!(
            UniquenessKey::from_seed([4u8; 32]).uniqueness_key("test-person-0001"),
            direct
        );
    }

    #[test]
    fn store_refuses_duplicate_in_epoch_only() {
        let mut store = MemoryStore::new();
        let row = UniquenessEntry {
            oprf_key_u: "aa".into(),
            epoch: 1,
            revocation_handle: "00".repeat(32),
        };
        store.insert(row.clone()).unwrap();
        assert_eq!(store.insert(row.clone()), Err(AlreadyEnrolled { epoch: 1 }));
        store.insert(UniquenessEntry { epoch: 2, ..row }).unwrap();
        assert_eq!(store.count(1), 1);
        assert_eq!(store.count(2), 1);
        assert!(store.has("aa", 1) && !store.has("bb", 1));
    }
}

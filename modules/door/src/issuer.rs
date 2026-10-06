//! Door's side: issuer keys per epoch, the uniqueness check and blind issuance.

use crate::attributes::Attributes;
use crate::error::EnrolError;
use crate::identity::IdentityAssertion;
use crate::uniqueness::{UniquenessEntry, UniquenessKey, UniquenessStore};
use crate::{Suite, COMMITMENT_LEN, CREDENTIAL_HEADER, NYM_SECRETS, SUITE_ID};
use rand::{CryptoRng, RngCore};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zkryptium::bbsplus::keys::{BBSplusPublicKey, BBSplusSecretKey};
use zkryptium::bbsplus::pseudonym::PseudonymSecret;
use zkryptium::keys::pair::KeyPair;
use zkryptium::schemes::algorithms::BBSplus;
use zkryptium::schemes::generics::BlindSignature;
use zkryptium::utils::util::bbsplus_utils::hash_to_scalar;

/// The public part of an epoch's issuer key (03-data-model `IssuerKey`). Published on Record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IssuerKey {
    /// Epoch number.
    pub epoch: u32,
    /// BBS public key: compressed G2 point, 96 bytes, lowercase hex.
    pub bbs_public_key: String,
    /// Ciphersuite identifier, [`SUITE_ID`].
    pub ciphersuite: String,
    /// Start of validity, RFC 3339.
    pub valid_from: String,
    /// End of validity, RFC 3339.
    pub valid_to: String,
}

impl IssuerKey {
    /// Decode the public key.
    pub fn public_key(&self) -> Result<BBSplusPublicKey, String> {
        if self.ciphersuite != SUITE_ID {
            return Err(format!("unsupported ciphersuite {:?}", self.ciphersuite));
        }
        let bytes = hex::decode(&self.bbs_public_key).map_err(|e| e.to_string())?;
        BBSplusPublicKey::from_bytes(&bytes).map_err(|e| e.to_string())
    }
}

/// An epoch's issuer key with its secret. Door keeps it (in an HSM in production); only the
/// [`IssuerKey`] half leaves.
pub struct IssuerSecret {
    key: IssuerKey,
    sk: BBSplusSecretKey,
    pk: BBSplusPublicKey,
}

impl IssuerSecret {
    /// Generate a fresh key for an epoch.
    pub fn generate<R: RngCore + CryptoRng>(
        epoch: u32,
        valid_from: &str,
        valid_to: &str,
        rng: &mut R,
    ) -> Self {
        let mut seed = [0u8; 32];
        rng.fill_bytes(&mut seed);
        Self::from_seed(epoch, valid_from, valid_to, &seed)
    }

    /// Derive the key deterministically from secret key material (at least 32 bytes), with the
    /// epoch as `key_info`, following the BBS draft's KeyGen. Used for test vectors and for
    /// keeping a key in a seed file.
    pub fn from_seed(epoch: u32, valid_from: &str, valid_to: &str, seed: &[u8]) -> Self {
        let key_info = format!("d2.door.issuer/1 epoch={epoch}");
        let pair = KeyPair::<BBSplus<Suite>>::generate(seed, Some(key_info.as_bytes()), None)
            .expect("BBS key generation cannot fail for 32+ bytes of key material");
        let (sk, pk) = pair.into_parts();
        Self {
            key: IssuerKey {
                epoch,
                bbs_public_key: hex::encode(pk.to_bytes()),
                ciphersuite: SUITE_ID.to_string(),
                valid_from: valid_from.to_string(),
                valid_to: valid_to.to_string(),
            },
            sk,
            pk,
        }
    }

    /// The public half.
    pub fn public(&self) -> &IssuerKey {
        &self.key
    }

    /// Epoch number.
    pub fn epoch(&self) -> u32 {
        self.key.epoch
    }
}

/// What Door returns to the holder after a successful enrolment: the blind signature and the
/// values the holder needs to finalise it. Contains nothing about the person beyond the coarse
/// attributes the holder already knows about themselves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issuance {
    /// The attributes Door signed (the holder needs them to make proofs).
    pub attributes: Attributes,
    /// Blind BBS signature, 80 bytes, hex.
    pub blind_signature: String,
    /// Door's share of the pseudonym secret (`signer_nym_entropy`), 32 bytes, hex. Added to the
    /// holder's share so neither side alone chooses the pseudonym secret.
    pub signer_nym_entropy: String,
}

/// Door. Holds the OPRF key, the issuer keys per epoch and the uniqueness store.
pub struct Issuer<S: UniquenessStore> {
    oprf: UniquenessKey,
    store: S,
    epochs: BTreeMap<u32, IssuerSecret>,
}

impl<S: UniquenessStore> Issuer<S> {
    /// A Door with no epochs yet.
    pub fn new(oprf: UniquenessKey, store: S) -> Self {
        Self {
            oprf,
            store,
            epochs: BTreeMap::new(),
        }
    }

    /// Add an epoch's key. Replaces a key for the same epoch.
    pub fn add_epoch(&mut self, secret: IssuerSecret) {
        self.epochs.insert(secret.epoch(), secret);
    }

    /// The public issuer keys, oldest epoch first (`GET /issuer-keys`).
    pub fn issuer_keys(&self) -> Vec<IssuerKey> {
        self.epochs.values().map(|s| s.key.clone()).collect()
    }

    /// The public key of one epoch.
    pub fn issuer_key(&self, epoch: u32) -> Option<&IssuerKey> {
        self.epochs.get(&epoch).map(|s| &s.key)
    }

    /// The uniqueness store (read access, for counts).
    pub fn store(&self) -> &S {
        &self.store
    }

    /// `u` for a person. Exposed for tests and vectors; Door does not return it to anyone.
    pub fn uniqueness_key(&self, person_id: &str) -> String {
        self.oprf.uniqueness_key(person_id)
    }

    /// Enrol: check uniqueness, then blind-sign the holder's commitment together with the
    /// coarse attributes (02-protocols section 1, steps 3 to 6). `commitment` is the holder's
    /// `commitment_with_proof` bytes. Fresh randomness for the revocation handle and Door's
    /// pseudonym entropy comes from `rng`.
    pub fn enrol<R: RngCore + CryptoRng>(
        &mut self,
        assertion: &IdentityAssertion,
        epoch: u32,
        commitment: &[u8],
        rng: &mut R,
    ) -> Result<Issuance, EnrolError> {
        let mut rid = [0u8; 32];
        rng.fill_bytes(&mut rid);
        let mut entropy_seed = [0u8; 32];
        rng.fill_bytes(&mut entropy_seed);
        self.enrol_with(assertion, epoch, commitment, rid, &entropy_seed)
    }

    /// [`Issuer::enrol`] with the randomness supplied: the revocation handle and a seed for
    /// Door's pseudonym entropy. For test vectors; production code uses `enrol`.
    pub fn enrol_with(
        &mut self,
        assertion: &IdentityAssertion,
        epoch: u32,
        commitment: &[u8],
        rid: [u8; 32],
        entropy_seed: &[u8],
    ) -> Result<Issuance, EnrolError> {
        let secret = self
            .epochs
            .get(&epoch)
            .ok_or(EnrolError::UnknownEpoch { epoch })?;
        // The BBS library indexes into the commitment without checking its length; refuse
        // anything but the exact size before it gets there.
        if commitment.len() != COMMITMENT_LEN {
            return Err(EnrolError::InvalidCommitment(format!(
                "expected {COMMITMENT_LEN} bytes, got {}",
                commitment.len()
            )));
        }
        let attributes = Attributes {
            jurisdiction_path: assertion.jurisdiction_path.clone(),
            adult: assertion.adult,
            epoch,
            rid: hex::encode(rid),
        };
        let messages = attributes
            .messages()
            .map_err(EnrolError::InvalidAttribute)?;

        // Step 3 and 4: uniqueness.
        let u = self.oprf.uniqueness_key(&assertion.person_id);
        if self.store.has(&u, epoch) {
            return Err(EnrolError::AlreadyEnrolled { epoch });
        }

        // Step 5: blind signature over the commitment and the attributes.
        let entropy = pseudonym_secret_from_seed(entropy_seed);
        let signature = BlindSignature::<BBSplus<Suite>>::blind_sign_with_nym(
            &secret.sk,
            &secret.pk,
            Some(commitment),
            NYM_SECRETS,
            Some(CREDENTIAL_HEADER),
            &entropy,
            Some(&messages),
        )
        .map_err(|e| match e {
            zkryptium::errors::Error::InvalidCommitment
            | zkryptium::errors::Error::InvalidCommitmentProof
            | zkryptium::errors::Error::DeserializationError(_) => {
                EnrolError::InvalidCommitment(e.to_string())
            }
            other => EnrolError::Signing(other.to_string()),
        })?;

        // Step 6: remember `u -> epoch` and the revocation handle, nothing else.
        self.store
            .insert(UniquenessEntry {
                oprf_key_u: u,
                epoch,
                revocation_handle: attributes.rid.clone(),
            })
            .map_err(|e| EnrolError::AlreadyEnrolled { epoch: e.epoch })?;

        Ok(Issuance {
            attributes,
            blind_signature: hex::encode(signature.to_bytes()),
            signer_nym_entropy: hex::encode(entropy.to_bytes()),
        })
    }
}

/// A pseudonym secret derived from arbitrary bytes by hashing to a scalar, so any seed gives a
/// valid scalar (a raw 32-byte string is only a valid scalar about half the time).
pub(crate) fn pseudonym_secret_from_seed(seed: &[u8]) -> PseudonymSecret {
    let scalar = hash_to_scalar::<Suite>(seed, b"d2.door.nym-secret/1")
        .expect("hash to scalar cannot fail for a short DST");
    PseudonymSecret::from_bytes(&scalar.to_be_bytes())
        .expect("a reduced scalar is always a valid pseudonym secret")
}

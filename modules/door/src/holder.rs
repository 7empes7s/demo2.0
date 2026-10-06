//! The holder's side: the secret, the blind commitment, the finalised credential and
//! presentations.

use crate::attributes::{Attributes, Disclosed, Disclosure, MESSAGE_COUNT};
use crate::error::HolderError;
use crate::issuer::{pseudonym_secret_from_seed, Issuance, IssuerKey};
use crate::pseudonym::Pseudonym;
use crate::{Suite, CREDENTIAL_HEADER, NYM_SECRETS};
use rand::{CryptoRng, RngCore};
use serde::{Deserialize, Serialize};
use zkryptium::bbsplus::commitment::BlindFactor;
use zkryptium::bbsplus::pseudonym::PseudonymSecret;
use zkryptium::schemes::algorithms::BBSplus;
use zkryptium::schemes::generics::{BlindSignature, Commitment, PoKSignature};

/// The holder's secret `s` (the draft's `prover_nym`), drawn on the device before enrolment.
pub struct Holder {
    prover_nym: PseudonymSecret,
}

impl std::fmt::Debug for Holder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Holder(<secret>)")
    }
}

/// The blind commitment the holder sends to Door, with the blinding factor the holder keeps.
pub struct Commit {
    /// `commitment_with_proof` bytes for Door.
    pub commitment: Vec<u8>,
    /// `secret_prover_blind`, kept by the holder for finalisation.
    pub blind: BlindFactor,
}

impl Holder {
    /// Draw a fresh secret.
    pub fn new<R: RngCore + CryptoRng>(rng: &mut R) -> Self {
        let mut seed = [0u8; 32];
        rng.fill_bytes(&mut seed);
        Self::from_seed(&seed)
    }

    /// Derive the secret from a seed (for test vectors).
    pub fn from_seed(seed: &[u8]) -> Self {
        Self {
            prover_nym: pseudonym_secret_from_seed(seed),
        }
    }

    /// The secret as 32 bytes, hex. Only for tests that check Door never saw it.
    pub fn secret_hex(&self) -> String {
        hex::encode(self.prover_nym.to_bytes())
    }

    /// Commit to `s` (02-protocols section 1, step 5). The commitment comes with a proof of
    /// correctness; the blinding factor stays on the device.
    pub fn commit(&self) -> Result<Commit, HolderError> {
        let (commitment, blind) =
            Commitment::<BBSplus<Suite>>::commit_with_nym(None, vec![self.prover_nym.clone()])
                .map_err(|e| HolderError::Proof(e.to_string()))?;
        Ok(Commit {
            commitment: commitment.to_bytes(),
            blind,
        })
    }

    /// Check Door's blind signature and finalise the credential. Fails if the signature does
    /// not verify under `issuer_key` over exactly the attributes in `issuance`.
    pub fn finalize(
        &self,
        issuer_key: &IssuerKey,
        issuance: &Issuance,
        blind: &BlindFactor,
    ) -> Result<Credential, HolderError> {
        if issuer_key.epoch != issuance.attributes.epoch {
            return Err(HolderError::EpochMismatch {
                key: issuer_key.epoch,
                issuance: issuance.attributes.epoch,
            });
        }
        let pk = issuer_key
            .public_key()
            .map_err(|detail| HolderError::Malformed {
                what: "issuer key",
                detail,
            })?;
        let messages = issuance
            .attributes
            .messages()
            .map_err(|detail| HolderError::Malformed {
                what: "attributes",
                detail,
            })?;
        let signature = decode_signature(&issuance.blind_signature)?;
        let entropy_bytes: [u8; 32] = hex::decode(&issuance.signer_nym_entropy)
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or(HolderError::Malformed {
                what: "signer_nym_entropy",
                detail: "expected 32 bytes of hex".into(),
            })?;
        let entropy =
            PseudonymSecret::from_bytes(&entropy_bytes).map_err(|e| HolderError::Malformed {
                what: "signer_nym_entropy",
                detail: e.to_string(),
            })?;

        let nym_secrets = signature
            .verify_finalize_with_nym(
                &pk,
                Some(CREDENTIAL_HEADER),
                Some(&messages),
                None,
                vec![self.prover_nym.clone()],
                Some(&entropy),
                Some(blind),
            )
            .map_err(|e| HolderError::BadSignature(e.to_string()))?;
        let nym_secret = nym_secrets
            .into_iter()
            .next()
            .ok_or_else(|| HolderError::Proof("no pseudonym secret returned".into()))?;

        Ok(Credential {
            epoch: issuance.attributes.epoch,
            attributes: issuance.attributes.clone(),
            signature: issuance.blind_signature.clone(),
            nym_secret: hex::encode(nym_secret.to_bytes()),
            blind: hex::encode(blind.to_bytes()),
        })
    }
}

fn decode_signature(hex_sig: &str) -> Result<BlindSignature<BBSplus<Suite>>, HolderError> {
    let bytes = hex::decode(hex_sig).map_err(|e| HolderError::Malformed {
        what: "blind_signature",
        detail: e.to_string(),
    })?;
    let array: [u8; 80] = bytes.try_into().map_err(|_| HolderError::Malformed {
        what: "blind_signature",
        detail: "expected 80 bytes".into(),
    })?;
    BlindSignature::<BBSplus<Suite>>::from_bytes(&array).map_err(|e| HolderError::Malformed {
        what: "blind_signature",
        detail: e.to_string(),
    })
}

/// A finalised credential. Lives only on the holder's device. Everything in it is secret to the
/// holder except the attributes, which only say what Door already knows about the person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Credential {
    /// Epoch of the issuer key.
    pub epoch: u32,
    /// The signed attributes.
    pub attributes: Attributes,
    /// BBS signature, 80 bytes, hex.
    pub signature: String,
    /// The final pseudonym secret (`s` plus Door's entropy), 32 bytes, hex.
    pub nym_secret: String,
    /// The blinding factor used at commitment, 32 bytes, hex. Part of the signed message set.
    pub blind: String,
}

/// A presentation for one context: the proof, the per-context pseudonym and what it discloses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Presentation {
    /// Epoch of the issuer key to verify against.
    pub epoch: u32,
    /// The context this presentation is bound to, e.g. `agora:lu.esch`.
    pub context: String,
    /// The verifier's challenge, hex. Signed into the proof as the presentation header.
    pub challenge: String,
    /// What the holder disclosed.
    pub disclosed: Disclosed,
    /// The per-context pseudonym.
    pub pseudonym: Pseudonym,
    /// The BBS proof with pseudonym, hex.
    pub proof: String,
}

impl Credential {
    /// Make a presentation for `context`, answering `challenge`, disclosing `disclosure`.
    /// Each call produces a fresh proof; the pseudonym is the same for the same context.
    pub fn present(
        &self,
        issuer_key: &IssuerKey,
        context: &str,
        challenge: &[u8],
        disclosure: &Disclosure,
    ) -> Result<Presentation, HolderError> {
        let pk = issuer_key
            .public_key()
            .map_err(|detail| HolderError::Malformed {
                what: "issuer key",
                detail,
            })?;
        let messages = self
            .attributes
            .messages()
            .map_err(|detail| HolderError::Malformed {
                what: "attributes",
                detail,
            })?;
        let (disclosed_indexes, disclosed) =
            self.attributes
                .disclose(disclosure)
                .map_err(|_| HolderError::JurisdictionTooDeep {
                    requested: disclosure.jurisdiction_levels,
                    available: self.attributes.jurisdiction_depth(),
                })?;
        let signature = hex::decode(&self.signature).map_err(|e| HolderError::Malformed {
            what: "signature",
            detail: e.to_string(),
        })?;
        let nym_secret = decode_secret(&self.nym_secret, "nym_secret")?;
        let blind_bytes: [u8; 32] = hex::decode(&self.blind)
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or(HolderError::Malformed {
                what: "blind",
                detail: "expected 32 bytes of hex".into(),
            })?;
        let blind = BlindFactor::from_bytes(&blind_bytes).map_err(|e| HolderError::Malformed {
            what: "blind",
            detail: e.to_string(),
        })?;

        let (proof, pseudonym) = PoKSignature::<BBSplus<Suite>>::proof_gen_with_nym(
            &pk,
            &signature,
            Some(CREDENTIAL_HEADER),
            Some(challenge),
            &vec![nym_secret],
            context.as_bytes(),
            Some(&messages),
            None,
            Some(&disclosed_indexes),
            None,
            Some(&blind),
        )
        .map_err(|e| HolderError::Proof(e.to_string()))?;

        Ok(Presentation {
            epoch: self.epoch,
            context: context.to_string(),
            challenge: hex::encode(challenge),
            disclosed,
            pseudonym: Pseudonym::from_point_bytes(&pseudonym.to_bytes()).map_err(|detail| {
                HolderError::Malformed {
                    what: "pseudonym",
                    detail,
                }
            })?,
            proof: hex::encode(proof.to_bytes()),
        })
    }

    /// Number of signer-known messages in the credential (fixed by the format).
    pub const fn message_count() -> usize {
        MESSAGE_COUNT
    }

    /// Number of pseudonym secrets in the credential (fixed by the format).
    pub const fn nym_secret_count() -> usize {
        NYM_SECRETS
    }
}

fn decode_secret(hex_secret: &str, what: &'static str) -> Result<PseudonymSecret, HolderError> {
    let bytes: [u8; 32] = hex::decode(hex_secret)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or(HolderError::Malformed {
            what,
            detail: "expected 32 bytes of hex".into(),
        })?;
    PseudonymSecret::from_bytes(&bytes).map_err(|e| HolderError::Malformed {
        what,
        detail: e.to_string(),
    })
}

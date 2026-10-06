//! Errors. Each variant names one cause so callers can act on it without parsing text.

use thiserror::Error;

/// Why Door refused an enrolment.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum EnrolError {
    /// The uniqueness key already has a credential in this epoch (02-protocols section 1,
    /// step 4). The lost-device path is not implemented yet.
    #[error("already enrolled in epoch {epoch}")]
    AlreadyEnrolled {
        /// The epoch the person is already enrolled in.
        epoch: u32,
    },
    /// Door has no issuer key for this epoch.
    #[error("no issuer key for epoch {epoch}")]
    UnknownEpoch {
        /// The requested epoch.
        epoch: u32,
    },
    /// The identity assertion carries an attribute Door cannot encode.
    #[error("invalid attribute: {0}")]
    InvalidAttribute(String),
    /// The holder's commitment (or its proof of correctness) did not verify.
    #[error("invalid commitment: {0}")]
    InvalidCommitment(String),
    /// The BBS library failed for another reason.
    #[error("signing failed: {0}")]
    Signing(String),
}

/// Why the holder could not finalise a credential or build a presentation.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum HolderError {
    /// The blind signature Door returned does not verify under the issuer key: either Door
    /// signed other attributes than it says, or the key is wrong.
    #[error("issuer signature does not verify: {0}")]
    BadSignature(String),
    /// Bytes could not be decoded.
    #[error("malformed {what}: {detail}")]
    Malformed {
        /// Which field.
        what: &'static str,
        /// What was wrong with it.
        detail: String,
    },
    /// The requested disclosure asks for more jurisdiction levels than the credential has.
    #[error("cannot disclose {requested} jurisdiction levels, credential has {available}")]
    JurisdictionTooDeep {
        /// Levels asked for.
        requested: usize,
        /// Levels in the credential.
        available: usize,
    },
    /// The BBS library failed for another reason.
    #[error("proof generation failed: {0}")]
    Proof(String),
    /// The issuer key is for another epoch than the issuance.
    #[error("issuer key is for epoch {key}, issuance is for epoch {issuance}")]
    EpochMismatch {
        /// Epoch of the key.
        key: u32,
        /// Epoch of the issuance.
        issuance: u32,
    },
}

/// Why a presentation was rejected. The verifier tells these apart before touching the
/// proof, so a wrong key or context is reported as such and not as a bad proof.
#[derive(Debug, Error, PartialEq, Eq, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum VerifyError {
    /// The presentation names another epoch than the issuer key it is checked against.
    #[error("presentation is for epoch {presentation}, key is for epoch {key}")]
    EpochMismatch {
        /// Epoch in the presentation.
        presentation: u32,
        /// Epoch of the issuer key.
        key: u32,
    },
    /// The presentation was made for another context. A proof replayed from one context to
    /// another lands here (or in `InvalidProof` if the context field was edited too).
    #[error("presentation is for context {presentation:?}, verifier is {verifier:?}")]
    ContextMismatch {
        /// Context in the presentation.
        presentation: String,
        /// Context the verifier runs.
        verifier: String,
    },
    /// The presentation does not carry the challenge the verifier issued (replay).
    #[error("presentation does not answer the verifier's challenge")]
    ChallengeMismatch,
    /// The verifier requires an attribute the presentation does not disclose.
    #[error("required attribute not disclosed: {0}")]
    MissingDisclosure(String),
    /// A field could not be decoded.
    #[error("malformed {what}: {detail}")]
    Malformed {
        /// Which field.
        what: String,
        /// What was wrong with it.
        detail: String,
    },
    /// The zero-knowledge proof does not verify: tampered disclosure, forged pseudonym,
    /// wrong key, edited context or epoch, or a proof that was never valid.
    #[error("invalid proof")]
    InvalidProof,
}

impl VerifyError {
    /// Short machine-readable code, as used in the test vectors.
    pub fn code(&self) -> &'static str {
        match self {
            VerifyError::EpochMismatch { .. } => "epoch_mismatch",
            VerifyError::ContextMismatch { .. } => "context_mismatch",
            VerifyError::ChallengeMismatch => "challenge_mismatch",
            VerifyError::MissingDisclosure(_) => "missing_disclosure",
            VerifyError::Malformed { .. } => "malformed",
            VerifyError::InvalidProof => "invalid_proof",
        }
    }
}

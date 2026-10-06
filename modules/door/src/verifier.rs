//! The verifier library: `verify(presentation, context) -> {pseudonym, attributes}`.

use crate::attributes::{Disclosed, Disclosure, MESSAGE_COUNT};
use crate::error::VerifyError;
use crate::holder::Presentation;
use crate::issuer::IssuerKey;
use crate::pseudonym::Pseudonym;
use crate::{proof_len, Suite, CREDENTIAL_HEADER, NYM_SECRETS};
use serde::{Deserialize, Serialize};
use zkryptium::bbsplus::pseudonym::BBSplusPseudonym;
use zkryptium::schemes::algorithms::BBSplus;
use zkryptium::schemes::generics::PoKSignature;

/// A verified presentation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Verified {
    /// The holder's pseudonym in this context. Stable for the same holder and context.
    pub pseudonym: Pseudonym,
    /// What the holder proved about their credential.
    pub disclosed: Disclosed,
    /// Epoch of the issuer key the proof verified under.
    pub epoch: u32,
}

/// Verify `presentation` against the epoch's `issuer_key`, for the verifier's own `context`
/// and the `challenge` it issued, requiring at least the attributes in `required`.
///
/// The checks run in this order and stop at the first failure, so the error names the real
/// cause: epoch, context, challenge, required disclosure, decoding, then the proof itself.
pub fn verify(
    issuer_key: &IssuerKey,
    presentation: &Presentation,
    context: &str,
    challenge: &[u8],
    required: &Disclosure,
) -> Result<Verified, VerifyError> {
    if presentation.epoch != issuer_key.epoch {
        return Err(VerifyError::EpochMismatch {
            presentation: presentation.epoch,
            key: issuer_key.epoch,
        });
    }
    if presentation.context != context {
        return Err(VerifyError::ContextMismatch {
            presentation: presentation.context.clone(),
            verifier: context.to_string(),
        });
    }
    if presentation.challenge != hex::encode(challenge) {
        return Err(VerifyError::ChallengeMismatch);
    }
    presentation
        .disclosed
        .satisfies(required)
        .map_err(VerifyError::MissingDisclosure)?;

    let pk = issuer_key
        .public_key()
        .map_err(|detail| malformed("issuer key", detail))?;
    let (indexes, messages) = presentation
        .disclosed
        .messages()
        .map_err(|detail| malformed("disclosed", detail))?;
    let proof_bytes =
        hex::decode(&presentation.proof).map_err(|e| malformed("proof", e.to_string()))?;
    // The BBS library indexes into the proof without checking its length and derives the
    // number of undisclosed messages from it with unchecked arithmetic, so the exact length is
    // enforced here before anything reaches it.
    let expected = proof_len(indexes.len());
    if proof_bytes.len() != expected {
        return Err(malformed(
            "proof",
            format!(
                "expected {expected} bytes for {} disclosed messages, got {}",
                indexes.len(),
                proof_bytes.len()
            ),
        ));
    }
    let proof = PoKSignature::<BBSplus<Suite>>::from_bytes(&proof_bytes)
        .map_err(|e| malformed("proof", e.to_string()))?;
    let pseudonym = BBSplusPseudonym::from_bytes(&presentation.pseudonym.point_bytes())
        .map_err(|e| malformed("pseudonym", e.to_string()))?;

    proof
        .proof_verify_with_nym(
            &pk,
            Some(CREDENTIAL_HEADER),
            Some(challenge),
            &pseudonym,
            context.as_bytes(),
            NYM_SECRETS,
            Some(MESSAGE_COUNT),
            Some(&messages),
            None,
            Some(&indexes),
            None,
        )
        .map_err(|_| VerifyError::InvalidProof)?;

    Ok(Verified {
        pseudonym: presentation.pseudonym.clone(),
        disclosed: presentation.disclosed.clone(),
        epoch: presentation.epoch,
    })
}

fn malformed(what: &str, detail: String) -> VerifyError {
    VerifyError::Malformed {
        what: what.to_string(),
        detail,
    }
}

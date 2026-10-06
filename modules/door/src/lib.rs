//! Door: state identity in, unlinkable anonymous credential out.
//!
//! This crate is the protocol core described in `docs/architecture/02-protocols.md` section 1,
//! with a mock identity provider in place of the EUDI wallet or LuxTrust. It is **unaudited**
//! and must not be used for anything binding. See the module README for the security status
//! and for the list of deviations from the protocol document.
//!
//! Roles and the flow between them:
//!
//! 1. The holder (citizen's app) draws a secret `s` ([`Holder`]) and sends a blind
//!    commitment to it.
//! 2. Door ([`Issuer`]) checks the person's identity assertion, computes the uniqueness key
//!    `u = OPRF_K(person_id)` ([`UniquenessKey`]), refuses a second enrolment for the same `u`
//!    in the same epoch ([`UniquenessStore`]), and returns a blind BBS signature over the
//!    coarse attributes ([`Attributes`]: jurisdiction path, adult, epoch, revocation handle)
//!    plus the holder's committed secret. Door never sees `s`.
//! 3. The holder finalises the [`Credential`] and, for each context (an Agora area, a Booth
//!    round), produces a [`Presentation`]: a BBS proof disclosing only what the context needs
//!    and a per-context [`Pseudonym`] that is stable within the context and unlinkable
//!    across contexts.
//! 4. A verifier calls [`verify`] with the epoch's [`IssuerKey`] and gets the pseudonym and
//!    the disclosed attributes back, or a precise [`VerifyError`].
//!
//! Cryptography comes from reviewed crates only: `zkryptium` for BBS (IRTF CFRG BBS draft 12),
//! blind BBS (blind-signatures draft 02) and per-verifier pseudonyms (per-verifier-linkability
//! draft 03) over BLS12-381; `voprf` for the OPRF (RFC 9497, ristretto255). Nothing here does
//! curve arithmetic by hand.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod attributes;
pub mod error;
pub mod holder;
pub mod identity;
pub mod issuer;
pub mod pseudonym;
pub mod uniqueness;
pub mod vectors;
pub mod verifier;

pub use attributes::{Attributes, Disclosed, Disclosure, JURISDICTION_LEVELS};
pub use error::{EnrolError, HolderError, VerifyError};
pub use holder::{Credential, Holder, Presentation};
pub use identity::{IdentityAssertion, IdentityError, IdentityProvider, MockIdProvider};
pub use issuer::{Issuance, Issuer, IssuerKey, IssuerSecret};
pub use pseudonym::Pseudonym;
pub use uniqueness::{MemoryStore, UniquenessEntry, UniquenessKey, UniquenessStore};
pub use verifier::{verify, Verified};

/// The BBS ciphersuite every Door object uses: BLS12-381 G1 with SHA-256 (XMD).
pub type Suite = zkryptium::bbsplus::ciphersuites::Bls12381Sha256;

/// Name of the ciphersuite as published in issuer keys and test vectors.
pub const SUITE_ID: &str = "BBS_BLS12381G1_XMD:SHA-256_SSWU_RO_";

/// Header signed into every credential. It names the credential format so a signature from
/// Door can never be mistaken for one over another format using the same key.
pub const CREDENTIAL_HEADER: &[u8] = b"d2.door.credential/1";

/// Number of pseudonym secrets in a credential (the draft allows a vector; Door uses one).
pub const NYM_SECRETS: usize = 1;

/// Number of scalars a credential signs: the signer-known messages, the holder's blinding
/// factor and the pseudonym secret(s).
pub const SIGNED_SCALARS: usize = attributes::MESSAGE_COUNT + 1 + NYM_SECRETS;

/// Exact byte length of a holder commitment (`commitment_with_proof`): one compressed G1
/// point, then the proof's `s_cap`, one `m_cap` per pseudonym secret, and the challenge.
pub const COMMITMENT_LEN: usize = 48 + 32 * (NYM_SECRETS + 2);

/// Exact byte length of a proof that discloses `disclosed` of the signer-known messages:
/// three compressed G1 points, `e_cap`, `r1_cap`, `r3_cap`, one `m_cap` per undisclosed
/// scalar, and the challenge.
pub const fn proof_len(disclosed: usize) -> usize {
    3 * 48 + 32 * (3 + (SIGNED_SCALARS - disclosed) + 1)
}

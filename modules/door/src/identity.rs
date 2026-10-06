//! The identity input: what Door learns about a person at enrolment, and where from.
//!
//! In production this is an OpenID4VP presentation from the EU Digital Identity Wallet or a
//! LuxTrust login (02-protocols section 1, step 2). Neither is integrated yet: both need a
//! relying-party registration that only Marouane can open. v1 ships [`MockIdProvider`], a
//! fixture-backed stand-in with the same output shape, so the rest of the protocol can be
//! built and tested against it.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

/// The minimum attributes Door asks the identity provider for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityAssertion {
    /// Unique person identifier as the provider gives it (for Luxembourg, the national
    /// identification number). Door keys the OPRF with it and never stores it.
    pub person_id: String,
    /// Age over 18.
    pub adult: bool,
    /// Residence as a Charter jurisdiction path, e.g. `lu.esch`.
    pub jurisdiction_path: String,
    /// Which provider asserted this (`mock`, later `eudi` or `luxtrust`).
    pub provider: String,
}

/// Why an identity token was refused.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum IdentityError {
    /// The provider does not know this token.
    #[error("unknown identity token")]
    Unknown,
}

/// Turns a provider-specific token into an [`IdentityAssertion`].
pub trait IdentityProvider {
    /// Resolve a token. For the mock provider the token is the fixture key.
    fn assert_identity(&self, token: &str) -> Result<IdentityAssertion, IdentityError>;
}

/// Fixture-backed identity provider for development and tests. Person ids are made up and
/// carry a `test-person-` prefix so they can never be mistaken for real identifiers.
#[derive(Debug, Clone, Default)]
pub struct MockIdProvider {
    people: BTreeMap<String, IdentityAssertion>,
}

impl MockIdProvider {
    /// An empty provider.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a person. `token` is what the app will present; it maps to one assertion.
    pub fn add(&mut self, token: &str, person_id: &str, adult: bool, jurisdiction_path: &str) {
        self.people.insert(
            token.to_string(),
            IdentityAssertion {
                person_id: person_id.to_string(),
                adult,
                jurisdiction_path: jurisdiction_path.to_string(),
                provider: "mock".to_string(),
            },
        );
    }

    /// Three residents used by the demo and the test vectors: two adults in Esch (one of
    /// whom also holds a second token, as a person with two devices would), and a minor in
    /// Luxembourg City.
    pub fn demo() -> Self {
        let mut p = Self::new();
        p.add("alice-phone", "test-person-0001", true, "lu.esch");
        p.add("alice-tablet", "test-person-0001", true, "lu.esch");
        p.add("bob-phone", "test-person-0002", true, "lu.esch.42063");
        p.add("carol-phone", "test-person-0003", false, "lu.luxembourg");
        p
    }

    /// The fixture tokens, sorted.
    pub fn tokens(&self) -> Vec<&str> {
        self.people.keys().map(String::as_str).collect()
    }
}

impl IdentityProvider for MockIdProvider {
    fn assert_identity(&self, token: &str) -> Result<IdentityAssertion, IdentityError> {
        self.people
            .get(token)
            .cloned()
            .ok_or(IdentityError::Unknown)
    }
}

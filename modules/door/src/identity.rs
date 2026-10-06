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
    /// Unique person identifier (for Luxembourg, the national identification number). Door
    /// keys the OPRF with it byte for byte and never stores it, so it must be in the one
    /// canonical form [`IdentityAssertion::check_person_id`] accepts; an adapter normalises
    /// whatever its provider emits before building the assertion.
    pub person_id: String,
    /// Age over 18.
    pub adult: bool,
    /// Residence as a Charter jurisdiction path, e.g. `lu.esch`.
    pub jurisdiction_path: String,
    /// Which provider asserted this (`mock`, later `eudi` or `luxtrust`).
    pub provider: String,
}

/// Prefix of the made-up person ids [`MockIdProvider`] uses.
pub const MOCK_PERSON_PREFIX: &str = "test-person-";

impl IdentityAssertion {
    /// Check that `person_id` is canonical, so one person always gives one uniqueness key.
    ///
    /// - Real providers (anything but `mock`): a Luxembourg national identification number,
    ///   exactly 13 ASCII digits. No spaces, separators or other characters, nothing trimmed.
    /// - `mock`: `test-person-` followed by exactly 4 ASCII digits, so a fixture id can never be
    ///   mistaken for a real one.
    ///
    /// Anything else is refused rather than normalised: normalising here would hide an adapter
    /// that emits two spellings for one person.
    pub fn check_person_id(&self) -> Result<(), String> {
        let id = self.person_id.as_str();
        let ok = if self.provider == "mock" {
            id.strip_prefix(MOCK_PERSON_PREFIX)
                .is_some_and(|n| n.len() == 4 && n.bytes().all(|b| b.is_ascii_digit()))
        } else {
            id.len() == 13 && id.bytes().all(|b| b.is_ascii_digit())
        };
        if ok {
            Ok(())
        } else if self.provider == "mock" {
            Err(format!(
                "mock person_id must be {MOCK_PERSON_PREFIX:?} and 4 ASCII digits, got {id:?}"
            ))
        } else {
            Err(format!(
                "person_id must be exactly 13 ASCII digits (Luxembourg national identification number), got {} characters",
                id.chars().count()
            ))
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn assertion(provider: &str, person_id: &str) -> IdentityAssertion {
        IdentityAssertion {
            person_id: person_id.into(),
            adult: true,
            jurisdiction_path: "lu".into(),
            provider: provider.into(),
        }
    }

    #[test]
    fn person_id_must_be_canonical() {
        assert!(assertion("eudi", "1980010112345").check_person_id().is_ok());
        assert!(assertion("luxtrust", "0000000000000")
            .check_person_id()
            .is_ok());
        for bad in [
            "",
            " 1980010112345",
            "1980010112345 ",
            "1980010112345\n",
            "198001011234",
            "19800101123456",
            "1980 0101 12345",
            "1980-01-01-12345",
            "198001011234a",
            "１980010112345",
            "test-person-0001",
        ] {
            assert!(
                assertion("eudi", bad).check_person_id().is_err(),
                "eudi {bad:?}"
            );
        }
        assert!(assertion("mock", "test-person-0001")
            .check_person_id()
            .is_ok());
        for bad in [
            "1980010112345",
            "test-person-1",
            "test-person-00001",
            "test-person-000a",
            " test-person-0001",
            "Test-person-0001",
        ] {
            assert!(
                assertion("mock", bad).check_person_id().is_err(),
                "mock {bad:?}"
            );
        }
        for token in MockIdProvider::demo().tokens() {
            let a = MockIdProvider::demo().assert_identity(token).unwrap();
            assert!(a.check_person_id().is_ok(), "{token}");
        }
    }
}

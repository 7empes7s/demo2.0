//! The coarse attributes a credential carries and how they become BBS messages.
//!
//! A credential signs exactly [`MESSAGE_COUNT`] signer-known messages, in this order:
//!
//! | index | message | example |
//! |---|---|---|
//! | 0..4 | `jurisdiction.<i>=<prefix of the path with i+1 levels>`, or `jurisdiction.<i>=` when the path is shorter | `jurisdiction.1=lu.esch` |
//! | 4 | `adult=<true or false>` | `adult=true` |
//! | 5 | `epoch=<decimal>` | `epoch=1` |
//! | 6 | `rid=<32 bytes, lowercase hex>` | never disclosed |
//!
//! The jurisdiction path is split into one message per level so a presentation can disclose a
//! prefix ("lives in lu.esch") without revealing the deeper levels. The holder's secret `s` is
//! not in this list: it is the pseudonym secret the holder commits to blindly, and the BBS
//! library appends it after these messages.

use serde::{Deserialize, Serialize};

/// Maximum depth of a jurisdiction path (country, region, commune, district).
pub const JURISDICTION_LEVELS: usize = 4;
/// Index of the `adult` message.
pub const ADULT_INDEX: usize = JURISDICTION_LEVELS;
/// Index of the `epoch` message.
pub const EPOCH_INDEX: usize = JURISDICTION_LEVELS + 1;
/// Index of the `rid` message.
pub const RID_INDEX: usize = JURISDICTION_LEVELS + 2;
/// Number of signer-known messages in a credential.
pub const MESSAGE_COUNT: usize = JURISDICTION_LEVELS + 3;

/// Everything Door signs into a credential. Door knows all of it; the holder learns it with
/// the signature. Nothing here identifies a person: the revocation handle is random and is
/// never disclosed in a presentation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attributes {
    /// Dotted jurisdiction path, root first, as in Charter: `lu`, `lu.esch`, `lu.esch.42063`.
    pub jurisdiction_path: String,
    /// Age over 18 at enrolment.
    pub adult: bool,
    /// Enrolment epoch (Charter `door.epoch_months` long).
    pub epoch: u32,
    /// Revocation handle, 32 random bytes in hex. Door escrows it; the holder never shows it.
    pub rid: String,
}

/// Which attributes a presentation discloses. The verifier states what it needs; the holder
/// discloses exactly that and the verifier refuses anything less.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Disclosure {
    /// Number of jurisdiction levels to disclose, 0 to [`JURISDICTION_LEVELS`]. `2` reveals
    /// `lu.esch` and nothing below it.
    pub jurisdiction_levels: usize,
    /// Disclose the `adult` flag.
    pub adult: bool,
    /// Disclose the `epoch` attribute (the epoch is also implied by the issuer key).
    pub epoch: bool,
}

/// What a verified presentation disclosed.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Disclosed {
    /// The disclosed prefix of the jurisdiction path, if any levels were disclosed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jurisdiction_path: Option<String>,
    /// The adult flag, if disclosed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adult: Option<bool>,
    /// The epoch attribute, if disclosed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epoch: Option<u32>,
}

/// Check a jurisdiction path: 1 to [`JURISDICTION_LEVELS`] levels of `[a-z0-9-]+` joined by `.`.
pub fn validate_jurisdiction_path(path: &str) -> Result<Vec<&str>, String> {
    let levels: Vec<&str> = path.split('.').collect();
    if levels.len() > JURISDICTION_LEVELS {
        return Err(format!(
            "jurisdiction path {path:?} has {} levels, at most {JURISDICTION_LEVELS} allowed",
            levels.len()
        ));
    }
    for level in &levels {
        if level.is_empty()
            || !level
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(format!(
                "jurisdiction path {path:?}: levels are 1+ characters of a-z 0-9 -"
            ));
        }
    }
    Ok(levels)
}

/// The jurisdiction prefix messages for a path: one per possible level, empty past the end.
fn jurisdiction_messages(path: &str) -> Result<Vec<Vec<u8>>, String> {
    let levels = validate_jurisdiction_path(path)?;
    Ok((0..JURISDICTION_LEVELS)
        .map(|i| {
            let prefix = if i < levels.len() {
                levels[..=i].join(".")
            } else {
                String::new()
            };
            format!("jurisdiction.{i}={prefix}").into_bytes()
        })
        .collect())
}

impl Attributes {
    /// Validate the attributes.
    pub fn validate(&self) -> Result<(), String> {
        validate_jurisdiction_path(&self.jurisdiction_path)?;
        match hex::decode(&self.rid) {
            Ok(bytes) if bytes.len() == 32 && self.rid == hex::encode(&bytes) => Ok(()),
            _ => Err("rid must be 32 bytes as lowercase hex".to_string()),
        }
    }

    /// The [`MESSAGE_COUNT`] signer-known messages, in signing order.
    pub fn messages(&self) -> Result<Vec<Vec<u8>>, String> {
        self.validate()?;
        let mut messages = jurisdiction_messages(&self.jurisdiction_path)?;
        messages.push(format!("adult={}", self.adult).into_bytes());
        messages.push(format!("epoch={}", self.epoch).into_bytes());
        messages.push(format!("rid={}", self.rid).into_bytes());
        debug_assert_eq!(messages.len(), MESSAGE_COUNT);
        Ok(messages)
    }

    /// Number of levels in the jurisdiction path.
    pub fn jurisdiction_depth(&self) -> usize {
        self.jurisdiction_path.split('.').count()
    }

    /// The indexes a [`Disclosure`] reveals, ascending, and the resulting [`Disclosed`] view.
    pub fn disclose(&self, disclosure: &Disclosure) -> Result<(Vec<usize>, Disclosed), String> {
        let levels = validate_jurisdiction_path(&self.jurisdiction_path)?;
        if disclosure.jurisdiction_levels > levels.len() {
            return Err(format!(
                "cannot disclose {} jurisdiction levels, credential has {}",
                disclosure.jurisdiction_levels,
                levels.len()
            ));
        }
        let mut indexes: Vec<usize> = (0..disclosure.jurisdiction_levels).collect();
        let mut disclosed = Disclosed::default();
        if disclosure.jurisdiction_levels > 0 {
            disclosed.jurisdiction_path = Some(levels[..disclosure.jurisdiction_levels].join("."));
        }
        if disclosure.adult {
            indexes.push(ADULT_INDEX);
            disclosed.adult = Some(self.adult);
        }
        if disclosure.epoch {
            indexes.push(EPOCH_INDEX);
            disclosed.epoch = Some(self.epoch);
        }
        Ok((indexes, disclosed))
    }
}

impl Disclosed {
    /// Rebuild the disclosed messages and their indexes, as the verifier must to check a proof.
    /// The order matches [`Attributes::disclose`].
    pub fn messages(&self) -> Result<(Vec<usize>, Vec<Vec<u8>>), String> {
        let mut indexes = Vec::new();
        let mut messages = Vec::new();
        if let Some(path) = &self.jurisdiction_path {
            let levels = validate_jurisdiction_path(path)?;
            for (i, _) in levels.iter().enumerate() {
                indexes.push(i);
                messages.push(format!("jurisdiction.{i}={}", levels[..=i].join(".")).into_bytes());
            }
        }
        if let Some(adult) = self.adult {
            indexes.push(ADULT_INDEX);
            messages.push(format!("adult={adult}").into_bytes());
        }
        if let Some(epoch) = self.epoch {
            indexes.push(EPOCH_INDEX);
            messages.push(format!("epoch={epoch}").into_bytes());
        }
        Ok((indexes, messages))
    }

    /// Does this view satisfy what the verifier asked for?
    pub fn satisfies(&self, required: &Disclosure) -> Result<(), String> {
        let depth = self
            .jurisdiction_path
            .as_deref()
            .map(|p| p.split('.').count())
            .unwrap_or(0);
        if depth < required.jurisdiction_levels {
            return Err(format!(
                "jurisdiction ({} of {} levels)",
                depth, required.jurisdiction_levels
            ));
        }
        if required.adult && self.adult.is_none() {
            return Err("adult".to_string());
        }
        if required.epoch && self.epoch.is_none() {
            return Err("epoch".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attrs() -> Attributes {
        Attributes {
            jurisdiction_path: "lu.esch".into(),
            adult: true,
            epoch: 1,
            rid: "00".repeat(32),
        }
    }

    #[test]
    fn messages_in_order() {
        let m = attrs().messages().unwrap();
        assert_eq!(m.len(), MESSAGE_COUNT);
        assert_eq!(m[0], b"jurisdiction.0=lu");
        assert_eq!(m[1], b"jurisdiction.1=lu.esch");
        assert_eq!(m[2], b"jurisdiction.2=");
        assert_eq!(m[3], b"jurisdiction.3=");
        assert_eq!(m[4], b"adult=true");
        assert_eq!(m[5], b"epoch=1");
        assert_eq!(m[6], format!("rid={}", "00".repeat(32)).as_bytes());
    }

    #[test]
    fn disclose_and_rebuild_agree() {
        let a = attrs();
        let all = a.messages().unwrap();
        let d = Disclosure {
            jurisdiction_levels: 1,
            adult: true,
            epoch: false,
        };
        let (indexes, view) = a.disclose(&d).unwrap();
        assert_eq!(indexes, vec![0, ADULT_INDEX]);
        assert_eq!(view.jurisdiction_path.as_deref(), Some("lu"));
        let (idx2, msgs) = view.messages().unwrap();
        assert_eq!(idx2, indexes);
        for (i, m) in idx2.iter().zip(&msgs) {
            assert_eq!(&all[*i], m);
        }
        assert!(view.satisfies(&d).is_ok());
        assert!(view
            .satisfies(&Disclosure {
                jurisdiction_levels: 2,
                ..d
            })
            .is_err());
    }

    #[test]
    fn rejects_bad_paths() {
        assert!(validate_jurisdiction_path("").is_err());
        assert!(validate_jurisdiction_path("lu..esch").is_err());
        assert!(validate_jurisdiction_path("LU").is_err());
        assert!(validate_jurisdiction_path("a.b.c.d.e").is_err());
        assert!(validate_jurisdiction_path("lu.esch.42063").is_ok());
        assert!(attrs()
            .disclose(&Disclosure {
                jurisdiction_levels: 3,
                adult: false,
                epoch: false
            })
            .is_err());
    }
}

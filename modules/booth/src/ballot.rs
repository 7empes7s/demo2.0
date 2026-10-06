//! Voters and ballots: exponential ElGamal under the joint key, one ciphertext per option,
//! a disjunctive Chaum-Pedersen proof that each encrypts 0 or 1, a Chaum-Pedersen proof that
//! they sum to exactly 1, and an Ed25519 signature by the voter's round key.

use crate::board::canonical;
use crate::error::BoothError;
use crate::group::{
    append_point, append_u64, challenge, g, hex_bytes, point, point_hex, random_scalar, scalar,
    scalar_hex, transcript, ChaumPedersen,
};
use crate::wire::{valid_id, Ballot, BitProof, Ciphertext, Signup};
use curve25519_dalek::ristretto::RistrettoPoint;
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::{Identity, VartimeMultiscalarMul};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use merlin::Transcript;
use rand::{CryptoRng, RngCore};
use sha2::{Digest, Sha256};

/// Domain separator of the signed ballot digest.
pub const BALLOT_DOMAIN: &[u8] = b"d2.booth.ballot/1";

/// What a voter needs to know about the round to cast: taken from the board.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoundPublic {
    /// Round id.
    pub round_id: String,
    /// Joint key `K`.
    pub joint_key: RistrettoPoint,
    /// Number of options `L`.
    pub options: usize,
}

/// A voter: its pseudonym for the round and its round signing key.
pub struct Voter {
    nym: String,
    key: SigningKey,
}

impl Voter {
    /// A voter with pseudonym `nym` and a fresh round key.
    pub fn new<R: RngCore + CryptoRng>(nym: &str, rng: &mut R) -> Self {
        Self {
            nym: nym.to_string(),
            key: SigningKey::generate(rng),
        }
    }

    /// The pseudonym.
    pub fn nym(&self) -> &str {
        &self.nym
    }

    /// The sign-up entry.
    pub fn signup(&self) -> Signup {
        Signup {
            nym: self.nym.clone(),
            voter_key: hex::encode(self.key.verifying_key().as_bytes()),
        }
    }

    /// Encrypt a vote for option `choice` and sign it.
    pub fn ballot<R: RngCore + CryptoRng>(
        &self,
        round: &RoundPublic,
        choice: usize,
        rng: &mut R,
    ) -> Result<Ballot, BoothError> {
        if choice >= round.options {
            return Err(BoothError::Malformed(format!(
                "choice {choice} of {} options",
                round.options
            )));
        }
        let k = &round.joint_key;
        let mut choices = Vec::with_capacity(round.options);
        let mut bit_proofs = Vec::with_capacity(round.options);
        let mut r_sum = Scalar::ZERO;
        let mut a_sum = RistrettoPoint::identity();
        let mut b_sum = RistrettoPoint::identity();
        for opt in 0..round.options {
            let bit = opt == choice;
            let r = random_scalar(rng);
            let a = r * g();
            let b = if bit { r * k + g() } else { r * k };
            r_sum += r;
            a_sum += a;
            b_sum += b;
            let mut t = bit_transcript(&round.round_id, &self.nym, opt as u64, k, &a, &b);
            bit_proofs.push(prove_bit(&mut t, k, &a, &b, &r, bit, rng));
            choices.push(Ciphertext {
                a: point_hex(&a),
                b: point_hex(&b),
            });
        }
        // The sum (A, B − G) is a DH pair under (G, K) with witness Σr.
        let mut t = sum_transcript(&round.round_id, &self.nym, k, &a_sum, &b_sum);
        let sum_proof = ChaumPedersen::prove(&mut t, &g(), k, &r_sum, rng);
        let mut ballot = Ballot {
            round_id: round.round_id.clone(),
            nym: self.nym.clone(),
            voter_key: hex::encode(self.key.verifying_key().as_bytes()),
            choices,
            bit_proofs,
            sum_proof,
            signature: String::new(),
        };
        let digest = ballot_digest(&ballot)?;
        ballot.signature = hex::encode(self.key.sign(&digest).to_bytes());
        Ok(ballot)
    }
}

fn bit_transcript(
    round_id: &str,
    nym: &str,
    option: u64,
    k: &RistrettoPoint,
    a: &RistrettoPoint,
    b: &RistrettoPoint,
) -> Transcript {
    let mut t = transcript(b"bit", round_id);
    t.append_message(b"nym", nym.as_bytes());
    append_u64(&mut t, b"option", option);
    append_point(&mut t, b"joint_key", k);
    append_point(&mut t, b"a", a);
    append_point(&mut t, b"b", b);
    t
}

fn sum_transcript(
    round_id: &str,
    nym: &str,
    k: &RistrettoPoint,
    a_sum: &RistrettoPoint,
    b_sum: &RistrettoPoint,
) -> Transcript {
    let mut t = transcript(b"sum", round_id);
    t.append_message(b"nym", nym.as_bytes());
    append_point(&mut t, b"joint_key", k);
    append_point(&mut t, b"a_sum", a_sum);
    append_point(&mut t, b"b_sum", b_sum);
    t
}

/// Disjunctive proof: real branch for `bit`, simulated branch for the other.
fn prove_bit<R: RngCore + CryptoRng>(
    t: &mut Transcript,
    k: &RistrettoPoint,
    a: &RistrettoPoint,
    b: &RistrettoPoint,
    r: &Scalar,
    bit: bool,
    rng: &mut R,
) -> BitProof {
    // Statement of branch 0: (a, b); of branch 1: (a, b − G).
    let b1 = b - g();
    let w = random_scalar(rng);
    let c_fake = random_scalar(rng);
    let v_fake = random_scalar(rng);
    // Real branch commitments (w·G, w·K); fake branch commitments (v·G − c·a, v·K − c·b').
    let real = (w * g(), w * k);
    let fake_target = if bit { b } else { &b1 };
    let fake = (
        RistrettoPoint::vartime_multiscalar_mul([v_fake, -c_fake], [&g(), a]),
        RistrettoPoint::vartime_multiscalar_mul([v_fake, -c_fake], [k, fake_target]),
    );
    let (c0, c1) = if bit { (fake, real) } else { (real, fake) };
    append_point(t, b"commit_0_1", &c0.0);
    append_point(t, b"commit_0_2", &c0.1);
    append_point(t, b"commit_1_1", &c1.0);
    append_point(t, b"commit_1_2", &c1.1);
    let c = challenge(t, b"challenge");
    let c_real = c - c_fake;
    let v_real = w + c_real * r;
    let (challenge_0, response_0, response_1) = if bit {
        (c_fake, v_fake, v_real)
    } else {
        (c_real, v_real, v_fake)
    };
    BitProof {
        commit_0_1: point_hex(&c0.0),
        commit_0_2: point_hex(&c0.1),
        commit_1_1: point_hex(&c1.0),
        commit_1_2: point_hex(&c1.1),
        challenge_0: scalar_hex(&challenge_0),
        response_0: scalar_hex(&response_0),
        response_1: scalar_hex(&response_1),
    }
}

fn verify_bit(
    t: &mut Transcript,
    k: &RistrettoPoint,
    a: &RistrettoPoint,
    b: &RistrettoPoint,
    p: &BitProof,
) -> Result<(), BoothError> {
    let c01 = point("commit_0_1", &p.commit_0_1)?;
    let c02 = point("commit_0_2", &p.commit_0_2)?;
    let c11 = point("commit_1_1", &p.commit_1_1)?;
    let c12 = point("commit_1_2", &p.commit_1_2)?;
    let c0 = scalar("challenge_0", &p.challenge_0)?;
    let v0 = scalar("response_0", &p.response_0)?;
    let v1 = scalar("response_1", &p.response_1)?;
    append_point(t, b"commit_0_1", &c01);
    append_point(t, b"commit_0_2", &c02);
    append_point(t, b"commit_1_1", &c11);
    append_point(t, b"commit_1_2", &c12);
    let c = challenge(t, b"challenge");
    let c1 = c - c0;
    let b1 = b - g();
    let ok = RistrettoPoint::vartime_multiscalar_mul([v0, -c0], [&g(), a]) == c01
        && RistrettoPoint::vartime_multiscalar_mul([v0, -c0], [k, b]) == c02
        && RistrettoPoint::vartime_multiscalar_mul([v1, -c1], [&g(), a]) == c11
        && RistrettoPoint::vartime_multiscalar_mul([v1, -c1], [k, &b1]) == c12;
    if ok {
        Ok(())
    } else {
        Err(BoothError::ProofFailed)
    }
}

/// The 32 bytes a voter signs: `SHA-256(domain || 0x00 || canonical(ballot with signature ""))`.
pub fn ballot_digest(ballot: &Ballot) -> Result<[u8; 32], BoothError> {
    let mut unsigned = ballot.clone();
    unsigned.signature = String::new();
    let value = serde_json::to_value(&unsigned)
        .map_err(|e| BoothError::Malformed(format!("ballot: {e}")))?;
    let mut h = Sha256::new();
    h.update(BALLOT_DOMAIN);
    h.update([0u8]);
    h.update(canonical(&value)?.as_bytes());
    Ok(h.finalize().into())
}

/// Parse an Ed25519 public key from hex.
pub fn voter_key(text: &str) -> Result<VerifyingKey, BoothError> {
    let bytes = hex_bytes("voter_key", text, 32)?;
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    let key = VerifyingKey::from_bytes(&arr)
        .map_err(|_| BoothError::Malformed("voter_key: not an Ed25519 point".to_string()))?;
    if key.is_weak() {
        return Err(BoothError::Malformed(
            "voter_key: small-order point".to_string(),
        ));
    }
    Ok(key)
}

/// A ballot that passed every check, with its ciphertexts as points.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckedBallot {
    /// Pseudonym.
    pub nym: String,
    /// `(a, b)` per option.
    pub choices: Vec<(RistrettoPoint, RistrettoPoint)>,
}

/// Check a ballot against the round: round id, pseudonym shape, the registered key, shape,
/// signature, every bit proof and the sum proof. Says nothing about sign-up or ordering; the
/// state machine does that.
pub fn check_ballot(
    ballot: &Ballot,
    round: &RoundPublic,
    registered_key: &VerifyingKey,
) -> Result<CheckedBallot, BoothError> {
    if ballot.round_id != round.round_id {
        return Err(BoothError::Malformed("ballot: round_id".to_string()));
    }
    if !valid_id(&ballot.nym) {
        return Err(BoothError::Malformed("ballot: nym".to_string()));
    }
    let key = voter_key(&ballot.voter_key)?;
    if &key != registered_key {
        return Err(BoothError::NotSignedUp(ballot.nym.clone()));
    }
    if ballot.choices.len() != round.options || ballot.bit_proofs.len() != round.options {
        return Err(BoothError::Malformed(format!(
            "ballot: {} choices and {} proofs for {} options",
            ballot.choices.len(),
            ballot.bit_proofs.len(),
            round.options
        )));
    }
    let sig_bytes = hex_bytes("signature", &ballot.signature, 64)?;
    let signature = Signature::from_slice(&sig_bytes)
        .map_err(|_| BoothError::Malformed("signature".to_string()))?;
    let digest = ballot_digest(ballot)?;
    key.verify(&digest, &signature)
        .map_err(|_| BoothError::BadSignature)?;
    let k = &round.joint_key;
    let mut choices = Vec::with_capacity(round.options);
    let mut a_sum = RistrettoPoint::identity();
    let mut b_sum = RistrettoPoint::identity();
    for (opt, (ct, proof)) in ballot.choices.iter().zip(&ballot.bit_proofs).enumerate() {
        let a = point(&format!("choice {opt} a"), &ct.a)?;
        let b = point(&format!("choice {opt} b"), &ct.b)?;
        let mut t = bit_transcript(&round.round_id, &ballot.nym, opt as u64, k, &a, &b);
        verify_bit(&mut t, k, &a, &b, proof)?;
        a_sum += a;
        b_sum += b;
        choices.push((a, b));
    }
    let mut t = sum_transcript(&round.round_id, &ballot.nym, k, &a_sum, &b_sum);
    ballot
        .sum_proof
        .verify(&mut t, &g(), k, &a_sum, &(b_sum - g()))?;
    Ok(CheckedBallot {
        nym: ballot.nym.clone(),
        choices,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn round(rng: &mut StdRng) -> RoundPublic {
        RoundPublic {
            round_id: "r1".to_string(),
            joint_key: random_scalar(rng) * g(),
            options: 3,
        }
    }

    #[test]
    fn a_ballot_verifies_and_every_edit_fails() {
        let mut rng = StdRng::seed_from_u64(7);
        let round = round(&mut rng);
        let voter = Voter::new("nym-a", &mut rng);
        let key = voter_key(&voter.signup().voter_key).unwrap();
        let ballot = voter.ballot(&round, 1, &mut rng).unwrap();
        check_ballot(&ballot, &round, &key).unwrap();

        let other = Voter::new("nym-a", &mut rng);
        let other_key = voter_key(&other.signup().voter_key).unwrap();
        assert_eq!(
            check_ballot(&ballot, &round, &other_key),
            Err(BoothError::NotSignedUp("nym-a".to_string()))
        );

        let mut t = ballot.clone();
        t.choices.swap(0, 1);
        assert_eq!(
            check_ballot(&t, &round, &key),
            Err(BoothError::BadSignature)
        );

        let mut t = ballot.clone();
        t.nym = "nym-b".to_string();
        assert_eq!(
            check_ballot(&t, &round, &key),
            Err(BoothError::BadSignature)
        );

        let mut r2 = round.clone();
        r2.round_id = "r2".to_string();
        assert!(matches!(
            check_ballot(&ballot, &r2, &key),
            Err(BoothError::Malformed(_))
        ));

        let mut r3 = round.clone();
        r3.joint_key = random_scalar(&mut rng) * g();
        assert_eq!(
            check_ballot(&ballot, &r3, &key),
            Err(BoothError::ProofFailed)
        );
    }

    #[test]
    fn a_two_vote_ballot_cannot_be_proved() {
        // Build a ballot with the honest code, then re-sign one that encrypts two ones: the
        // sum proof must fail. Then one that encrypts 2 in one slot: the bit proof must fail.
        let mut rng = StdRng::seed_from_u64(8);
        let round = round(&mut rng);
        let voter = Voter::new("nym-c", &mut rng);
        let key = voter_key(&voter.signup().voter_key).unwrap();
        let mut ballot = voter.ballot(&round, 0, &mut rng).unwrap();
        // Add G to option 2's b: now two ones.
        let b = point("b", &ballot.choices[2].b).unwrap() + g();
        ballot.choices[2].b = point_hex(&b);
        ballot.signature = hex::encode(voter.key.sign(&ballot_digest(&ballot).unwrap()).to_bytes());
        assert_eq!(
            check_ballot(&ballot, &round, &key),
            Err(BoothError::ProofFailed)
        );
    }
}

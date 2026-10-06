//! Guardians: k-of-n threshold key for the round by joint Feldman verifiable secret sharing
//! (Pedersen 1991, "A threshold cryptosystem without a trusted party"), the scheme
//! ElectionGuard also uses.
//!
//! Each guardian `i` picks a random polynomial `f_i` of degree `k−1`, publishes Feldman
//! commitments `C_{i,l} = a_{i,l}·G` with a Schnorr proof of knowledge of `a_{i,0}`, and sends
//! guardian `j` the share `f_i(j)` over a private channel. Guardian `j` checks every share
//! against the commitments and keeps `x_j = Σ_i f_i(j)`. The joint key is `K = Σ_i C_{i,0}`
//! and every guardian's verification key `K_j = x_j·G` is computable from the board alone.
//!
//! Known property: joint Feldman lets the last guardian bias the key's distribution (Gennaro,
//! Jarecki, Krawczyk, Rabin 1999); the same authors show it is still secure for discrete-log
//! schemes such as ElGamal decryption, which is all Booth uses it for. The Schnorr proof stops
//! a guardian from publishing a commitment it does not know the secret of.
//!
//! The private channel is out of scope for v1: `run_dkg` passes shares in memory, which is
//! only right when one process plays every guardian (tests, demos). A real deployment runs
//! `Dealer` on each guardian's own machine and moves shares over an authenticated encrypted
//! channel. Guardians who send bad shares are refused (`BadShare`); there is no complaint and
//! reconstruction round, the round setup simply fails and restarts.

use crate::error::BoothError;
use crate::group::{
    append_point, append_u64, g, point, point_hex, random_scalar, transcript, ChaumPedersen,
    Schnorr,
};
use crate::wire::{DecryptionShare, GuardianCommitment, PartialDecryption, RoundKey};
use curve25519_dalek::ristretto::RistrettoPoint;
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::{Identity, VartimeMultiscalarMul};
use rand::{CryptoRng, RngCore};
use zeroize::Zeroizing;

/// A guardian during setup: holds its secret polynomial.
pub struct Dealer {
    index: u32,
    coeffs: Zeroizing<Vec<Scalar>>,
}

impl Dealer {
    /// Guardian `index` (1..=n) with a random polynomial of degree `threshold − 1`.
    pub fn new<R: RngCore + CryptoRng>(index: u32, threshold: u32, rng: &mut R) -> Self {
        let coeffs = (0..threshold).map(|_| random_scalar(rng)).collect();
        Self {
            index,
            coeffs: Zeroizing::new(coeffs),
        }
    }

    /// Guardian index.
    pub fn index(&self) -> u32 {
        self.index
    }

    /// The public commitments and proof to publish on the board.
    pub fn commitment<R: RngCore + CryptoRng>(
        &self,
        round_id: &str,
        rng: &mut R,
    ) -> GuardianCommitment {
        let points: Vec<RistrettoPoint> = self.coeffs.iter().map(|a| a * g()).collect();
        let mut t = transcript(b"guardian", round_id);
        append_u64(&mut t, b"guardian", u64::from(self.index));
        append_point(&mut t, b"constant", &points[0]);
        let proof = Schnorr::prove(&mut t, &self.coeffs[0], rng);
        GuardianCommitment {
            guardian: self.index,
            commitments: points.iter().map(point_hex).collect(),
            proof,
        }
    }

    /// The private share `f_i(j)` for guardian `j`. Send it over a private channel only.
    pub fn share_for(&self, j: u32) -> Zeroizing<Scalar> {
        Zeroizing::new(eval(&self.coeffs, j))
    }
}

/// `f(x)` by Horner's rule.
fn eval(coeffs: &[Scalar], x: u32) -> Scalar {
    let x = Scalar::from(x);
    coeffs.iter().rev().fold(Scalar::ZERO, |acc, c| acc * x + c)
}

/// Parsed commitments of one guardian, checked for shape and proof.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Commitments {
    /// Guardian index.
    pub guardian: u32,
    /// `C_l`, `l = 0..k`.
    pub points: Vec<RistrettoPoint>,
}

impl Commitments {
    /// Parse and check a published commitment for round `round_id` with threshold `k`.
    pub fn parse(
        c: &GuardianCommitment,
        round_id: &str,
        threshold: u32,
    ) -> Result<Self, BoothError> {
        if c.commitments.len() != threshold as usize {
            return Err(BoothError::Malformed(format!(
                "guardian {}: {} commitments, threshold is {threshold}",
                c.guardian,
                c.commitments.len()
            )));
        }
        let points = c
            .commitments
            .iter()
            .enumerate()
            .map(|(l, h)| point(&format!("guardian {} commitment {l}", c.guardian), h))
            .collect::<Result<Vec<_>, _>>()?;
        let mut t = transcript(b"guardian", round_id);
        append_u64(&mut t, b"guardian", u64::from(c.guardian));
        append_point(&mut t, b"constant", &points[0]);
        c.proof.verify(&mut t, &points[0])?;
        Ok(Self {
            guardian: c.guardian,
            points,
        })
    }

    /// `Σ_l j^l·C_l`: this dealer's contribution to guardian `j`'s verification key.
    pub fn evaluate(&self, j: u32) -> RistrettoPoint {
        let x = Scalar::from(j);
        let mut pow = Scalar::ONE;
        let scalars: Vec<Scalar> = self
            .points
            .iter()
            .map(|_| {
                let s = pow;
                pow *= x;
                s
            })
            .collect();
        RistrettoPoint::vartime_multiscalar_mul(scalars.iter(), self.points.iter())
    }

    /// Does `share` equal `f(j)` for this dealer's committed polynomial?
    pub fn check_share(&self, j: u32, share: &Scalar) -> bool {
        share * g() == self.evaluate(j)
    }
}

/// Derive the round key material from every guardian's commitments (in index order 1..=n).
pub fn derive_round_key(all: &[Commitments]) -> RoundKey {
    let joint = all
        .iter()
        .fold(RistrettoPoint::identity(), |acc, c| acc + c.points[0]);
    let n = all.len() as u32;
    let guardian_keys = (1..=n)
        .map(|j| {
            let k = all
                .iter()
                .fold(RistrettoPoint::identity(), |acc, c| acc + c.evaluate(j));
            point_hex(&k)
        })
        .collect();
    RoundKey {
        joint_key: point_hex(&joint),
        guardian_keys,
    }
}

/// A guardian after setup: its index and secret share `x_j`.
pub struct GuardianKey {
    index: u32,
    secret: Zeroizing<Scalar>,
}

impl GuardianKey {
    /// Combine the shares received from every dealer (including one's own), each already
    /// checked against that dealer's commitments.
    pub fn from_shares(index: u32, shares: &[Zeroizing<Scalar>]) -> Self {
        let secret = shares.iter().fold(Scalar::ZERO, |acc, s| acc + **s);
        Self {
            index,
            secret: Zeroizing::new(secret),
        }
    }

    /// Guardian index.
    pub fn index(&self) -> u32 {
        self.index
    }

    /// `K_j = x_j·G`.
    pub fn verification_key(&self) -> RistrettoPoint {
        *self.secret * g()
    }

    /// Partially decrypt every option's aggregate `(A_j, B_j)`: publishes `x·A_j` with a proof.
    pub fn partial_decryption<R: RngCore + CryptoRng>(
        &self,
        round_id: &str,
        aggregates: &[(RistrettoPoint, RistrettoPoint)],
        rng: &mut R,
    ) -> PartialDecryption {
        let kj = self.verification_key();
        let shares = aggregates
            .iter()
            .enumerate()
            .map(|(opt, (a, _))| {
                let m = *self.secret * a;
                let mut t = decryption_transcript(round_id, self.index, opt as u64, &kj, a, &m);
                let proof = ChaumPedersen::prove(&mut t, &g(), a, &self.secret, rng);
                DecryptionShare {
                    m: point_hex(&m),
                    proof,
                }
            })
            .collect();
        PartialDecryption {
            guardian: self.index,
            shares,
        }
    }
}

/// The transcript of one decryption share, statement included.
pub fn decryption_transcript(
    round_id: &str,
    guardian: u32,
    option: u64,
    kj: &RistrettoPoint,
    a: &RistrettoPoint,
    m: &RistrettoPoint,
) -> merlin::Transcript {
    let mut t = transcript(b"decrypt", round_id);
    append_u64(&mut t, b"guardian", u64::from(guardian));
    append_u64(&mut t, b"option", option);
    append_point(&mut t, b"guardian_key", kj);
    append_point(&mut t, b"aggregate", a);
    append_point(&mut t, b"share", m);
    t
}

/// Run the whole key generation in one process (shares passed in memory). Test and demo use
/// only: in a deployment every guardian runs its own `Dealer`.
pub fn run_dkg<R: RngCore + CryptoRng>(
    round_id: &str,
    guardians: u32,
    threshold: u32,
    rng: &mut R,
) -> Result<(Vec<GuardianCommitment>, Vec<GuardianKey>), BoothError> {
    let dealers: Vec<Dealer> = (1..=guardians)
        .map(|i| Dealer::new(i, threshold, rng))
        .collect();
    let published: Vec<GuardianCommitment> = dealers
        .iter()
        .map(|d| d.commitment(round_id, rng))
        .collect();
    let parsed = published
        .iter()
        .map(|c| Commitments::parse(c, round_id, threshold))
        .collect::<Result<Vec<_>, _>>()?;
    let mut keys = Vec::with_capacity(guardians as usize);
    for j in 1..=guardians {
        let mut shares = Vec::with_capacity(guardians as usize);
        for (dealer, commitments) in dealers.iter().zip(&parsed) {
            let share = dealer.share_for(j);
            if !commitments.check_share(j, &share) {
                return Err(BoothError::BadShare {
                    from: dealer.index(),
                    to: j,
                });
            }
            shares.push(share);
        }
        keys.push(GuardianKey::from_shares(j, &shares));
    }
    Ok((published, keys))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::group::lagrange_at_zero;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn any_k_shares_reconstruct_the_joint_secret_in_the_exponent() {
        let mut rng = StdRng::seed_from_u64(1);
        let (published, keys) = run_dkg("r", 5, 3, &mut rng).unwrap();
        let parsed: Vec<Commitments> = published
            .iter()
            .map(|c| Commitments::parse(c, "r", 3).unwrap())
            .collect();
        let rk = derive_round_key(&parsed);
        let joint = point("joint", &rk.joint_key).unwrap();
        for (i, k) in keys.iter().enumerate() {
            assert_eq!(
                point_hex(&k.verification_key()),
                rk.guardian_keys[i],
                "guardian {}",
                i + 1
            );
        }
        for set in [[1u32, 2, 3], [3, 4, 5], [1, 3, 5]] {
            let sum = set.iter().fold(RistrettoPoint::identity(), |acc, &j| {
                let lambda = lagrange_at_zero(j, &set).unwrap();
                acc + lambda * keys[j as usize - 1].verification_key()
            });
            assert_eq!(sum, joint, "set {set:?}");
        }
    }

    #[test]
    fn a_wrong_share_is_refused() {
        let mut rng = StdRng::seed_from_u64(2);
        let dealer = Dealer::new(1, 2, &mut rng);
        let c = Commitments::parse(&dealer.commitment("r", &mut rng), "r", 2).unwrap();
        let good = dealer.share_for(3);
        assert!(c.check_share(3, &good));
        assert!(!c.check_share(2, &good));
        assert!(!c.check_share(3, &(*good + Scalar::ONE)));
    }

    #[test]
    fn commitment_is_bound_to_round_and_index() {
        let mut rng = StdRng::seed_from_u64(3);
        let dealer = Dealer::new(2, 2, &mut rng);
        let c = dealer.commitment("round-a", &mut rng);
        assert!(Commitments::parse(&c, "round-a", 2).is_ok());
        assert_eq!(
            Commitments::parse(&c, "round-b", 2),
            Err(BoothError::ProofFailed)
        );
        let mut moved = c.clone();
        moved.guardian = 3;
        assert_eq!(
            Commitments::parse(&moved, "round-a", 2),
            Err(BoothError::ProofFailed)
        );
        assert!(matches!(
            Commitments::parse(&c, "round-a", 3),
            Err(BoothError::Malformed(_))
        ));
    }
}

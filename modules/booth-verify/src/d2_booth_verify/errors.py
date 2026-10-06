"""The error codes of spec/booth/README.md section 5."""

from __future__ import annotations

CODES = (
    "chain_broken",
    "malformed",
    "params",
    "out_of_order",
    "proof_failed",
    "bad_signature",
    "duplicate_signup",
    "not_signed_up",
    "ballot_replay",
    "below_threshold",
    "tally_mismatch",
    "no_tally",
)


class BoardError(Exception):
    """The board is invalid. `code` is one of CODES; `seq` is the entry, when there is one."""

    def __init__(self, code: str, detail: str = "", seq: int | None = None) -> None:
        assert code in CODES, code
        self.code = code
        self.detail = detail
        self.seq = seq
        super().__init__(f"{code}: {detail}" if detail else code)

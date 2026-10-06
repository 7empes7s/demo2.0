"""Who is acting: the participant interface Agora needs from an identity module.

Agora never sees a person. It sees a per-context pseudonym (`nym`): the same participant in the
same context always gets the same nym, and nyms from different contexts cannot be linked
(docs/architecture/02-protocols.md, section 1). Door will derive it from an anonymous credential
presentation. Door does not exist yet, so v1 ships `OpaqueNyms`, which trusts the caller's
string as the nym. That is enough to enforce one upvote per nym, but not one per human: anyone
who can reach the API can invent nyms. Run it on loopback only, behind a caller that issues
the participant ids, until a Door-backed `NymSource` replaces it.
"""

from __future__ import annotations

import re
from typing import Protocol

_OPAQUE = re.compile(r"[A-Za-z0-9_-]{16,128}")


class InvalidParticipant(ValueError):
    code = "invalid_participant"


class NymSource(Protocol):
    def nym(self, participant: str, context_id: str) -> str:
        """The participant's pseudonym in `context_id`. Raise InvalidParticipant if not valid."""
        ...


class OpaqueNyms:
    """Development stand-in for Door: the participant string is the nym, whatever the context.

    It must be 16 to 128 characters of A-Z, a-z, 0-9, `_` or `-`, so an email address, a name or
    a phone number is rejected rather than stored.
    """

    def nym(self, participant: str, context_id: str) -> str:
        if not isinstance(participant, str) or not _OPAQUE.fullmatch(participant):
            raise InvalidParticipant(
                "participant must be an opaque id: 16-128 characters of A-Z a-z 0-9 _ -"
            )
        return participant

"""Agora: the agenda forum. Ideas, one upvote per participant, a queue ranked by scope tier.

    from d2_agora import Agora, DoorNyms

    agora = Agora("agora.db", nyms=DoorNyms("http://127.0.0.1:8092", epoch=1))
    # participant: a Door presentation for context "agora:lu", answering agora.nyms.challenge()
    idea = agora.post_idea({"participant": {...}, "jurisdiction_id": "lu", "title": {...},
                            "text": {...}})
    agora.upvote(idea["id"], {...})
    agora.queue(["lu", "lu-commune-esch-sur-alzette"])

    # Contest a tier (needs `lottery=LotteryCli()` for the panel draw):
    agora.open_challenge(idea["id"], {"participant": {...}, "jurisdiction_id": "lu-commune-..."})

See README.md for the rules and spec/schemas/idea.schema.json for what an idea looks like.
"""

from .agora import (
    LIMITS,
    Agora,
    AgoraError,
    Conflict,
    DuplicateUpvote,
    Forbidden,
    UnknownChallenge,
    UnknownIdea,
    rank_key,
)
from .identity import (
    Challenges,
    DoorNyms,
    IdentityError,
    KeyedNyms,
    MissingKey,
    NymSource,
    ReadOnly,
)
from .sortition import LotteryCli, LotteryError, Sortition

__all__ = [
    "LIMITS",
    "Agora",
    "AgoraError",
    "Challenges",
    "Conflict",
    "DoorNyms",
    "DuplicateUpvote",
    "Forbidden",
    "IdentityError",
    "KeyedNyms",
    "LotteryCli",
    "LotteryError",
    "MissingKey",
    "NymSource",
    "ReadOnly",
    "Sortition",
    "UnknownChallenge",
    "UnknownIdea",
    "rank_key",
]

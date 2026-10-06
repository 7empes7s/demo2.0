"""Agora: the agenda forum. Ideas, one upvote per participant, a queue ranked by scope tier.

    from d2_agora import Agora, DoorNyms

    agora = Agora("agora.db", nyms=DoorNyms("http://127.0.0.1:8092", epoch=1))
    # participant: a Door presentation for context "agora:lu", answering agora.nyms.challenge()
    idea = agora.post_idea({"participant": {...}, "jurisdiction_id": "lu", "title": {...},
                            "text": {...}})
    agora.upvote(idea["id"], {...})
    agora.queue(["lu", "lu-commune-esch-sur-alzette"])

See README.md for the rules and spec/schemas/idea.schema.json for what an idea looks like.
"""

from .agora import (
    LIMITS,
    Agora,
    AgoraError,
    DuplicateUpvote,
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
)

__all__ = [
    "LIMITS",
    "Agora",
    "AgoraError",
    "Challenges",
    "DoorNyms",
    "DuplicateUpvote",
    "IdentityError",
    "KeyedNyms",
    "MissingKey",
    "NymSource",
    "UnknownIdea",
    "rank_key",
]

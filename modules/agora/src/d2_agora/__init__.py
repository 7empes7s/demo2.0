"""Agora: the agenda forum. Ideas, one upvote per participant, a queue ranked by scope tier.

    from d2_agora import Agora, KeyedNyms

    agora = Agora("agora.db", nyms=KeyedNyms.from_env())
    idea = agora.post_idea({"participant": "...", "jurisdiction_id": "lu", "title": {...},
                            "text": {...}})
    agora.upvote(idea["id"], "...")
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
from .identity import KeyedNyms, MissingKey, NymSource

__all__ = [
    "LIMITS",
    "Agora",
    "AgoraError",
    "DuplicateUpvote",
    "KeyedNyms",
    "MissingKey",
    "NymSource",
    "UnknownIdea",
    "rank_key",
]

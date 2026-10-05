# Sign only durable state

**Mistake (Record PR #13 review):** the log ran SQLite in WAL mode with `synchronous=NORMAL`, then signed checkpoints over freshly committed appends. NORMAL survives a process crash but not a power loss, so a signed root could be lost and a different root later signed for the same size: a split view from the log's own key.

**Rule:** anything that signs, publishes or anchors a statement about stored data must do so only after that data is fsynced (`PRAGMA synchronous=FULL`, or an explicit durable checkpoint first). Test for it.

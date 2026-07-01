# Gmail Draft State Is Not Reconciled In Phase 2D

Phase 2D should create and update Gmail drafts, then store Tendnote's last known external draft state from the immediate provider response. It should not read Gmail history or reconcile whether the user later sent, deleted, or edited the draft inside Gmail, because that would require broader Gmail read/sync behavior outside the phase boundary. Users may still mark the Tendnote draft as sent manually inside Tendnote when they send it elsewhere.

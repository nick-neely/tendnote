# Google Contacts Import Normalizes Phone Numbers for Matching

Phase 2E should normalize imported phone numbers into a canonical matching value, with a display value retained when useful for UI. Google's provider strings should not be treated as reliable duplicate keys by themselves; if Tendnote cannot confidently normalize a phone number, it may show it for review but should not use it as a strong deterministic match signal.

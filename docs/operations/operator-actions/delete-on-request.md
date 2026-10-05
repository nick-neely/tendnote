# Runbook: Delete on request

Delete an account whose holder asks by email because they cannot sign in.
Account holders who can sign in delete their own account in the app, and the
support reply points them there. That self-service deletion is also how this
runbook ends. The operator never deletes rows by hand, because the in-app
deletion is what journals the Deletion Record first
([ADR 0250](../../adr/0250-one-backup-window-bounds-recovery-and-the-deletion-tail.md)).
It also cancels billing, revokes sessions, and handles the account's
Household.

Every gated page offers deletion: the account page, and the pending,
restricted, Lapsed, and accept-terms pages. So a holder who can sign in at all
can delete.

## Trigger

A message at the support address asks to delete an account, and the sender
says they cannot sign in.

## Preconditions

1. The request came from the account's own email address. Compare the
   sender's address with the account's (see the
   [operations README](../README.md#operator-actions)). A request from any
   other address is refused: reply that it must come from the account's email.
2. The holder can still receive mail at that address. The sign-in link below
   is the confirmation. Without the mailbox, the request cannot be confirmed
   and is refused.

## Steps

1. Reply from the support mailbox. Say that a sign-in link is on its way, and
   that after signing in, **Delete account** is on the account page, or on the
   first page they reach if it is not the product's home.
2. On the app's **Forgot password** page, request a reset for the account's
   email. The reset link lets them set a password and sign in. It works for an
   account that signed up through GitHub too, because completing the reset
   adds a password to the account.
3. The holder follows the link, sets a password, signs in, and chooses
   **Delete account**, then confirms in the dialog.
4. If the deletion is refused because the holder owns a Household with other
   members, the refusal says what to do next. Point them to it. The operator
   does not override it.

## Record produced

The support thread records the request and the confirmation. The in-app
deletion writes the Deletion Record to the Recovery Journal before any row is
deleted. Under a [Legal Hold](legal-hold.md), the account closes and billing
stops, but the rows stay until the hold ends.

## Verification

- Against production's database,
  `select id from "user" where lower(email) = lower('<email>');` returns no row.
  If it still returns the account, the deletion is pending or held by a Legal
  Hold. The recovery cron finishes a pending one, and the operator is alerted if it is still incomplete after
  twenty-four hours.
- Reply to the holder that the account is deleted. The app sends no email for
  a deletion the holder made themselves.

## Rollback

None. A completed deletion cannot be undone, and a restore never brings a
deleted account back. Before the holder confirms, they can stop by not
following the link. The reset link expires on its own.

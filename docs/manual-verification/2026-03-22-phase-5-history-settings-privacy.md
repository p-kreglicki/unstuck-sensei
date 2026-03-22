# Phase 5 manual verification

## Environment

- Run `npm run build`
- Run `npm test --`
- Start the app with the usual desktop or web dev workflow

## Sign-up to onboarding to session

1. Create a fresh account.
2. Confirm the app lands on `/onboarding` instead of the shell.
3. Change the preferred work time and detection sensitivity, then submit.
4. Confirm the app redirects to `/` and the session screen mounts normally.
5. Refresh or relaunch and confirm onboarding is skipped on subsequent visits.

Expected:
- The shell routes do not render before onboarding completes.
- The saved preferred time and sensitivity persist after relaunch.

## Settings to runtime sync

1. Open `/settings`.
2. Disable detection and save.
3. Confirm the settings save succeeds and the detection state badge in the shell updates without relaunch.
4. Re-enable detection, switch sensitivity, and save again.
5. Start a timer block, change detection settings, and save.

Expected:
- Detection settings persist across refresh/relaunch.
- Runtime state updates immediately when no timer is active.
- During an active timer, the saved preference persists but timer suppression remains authoritative until the block resolves.

## History and session detail

1. Complete one session and abandon another so both `completed` and `incomplete` rows exist.
2. Open `/history` and scroll until the infinite-scroll sentinel loads another page.
3. Open a history row.
4. Confirm the detail screen shows the stored steps, timer blocks, and transcript.

Expected:
- Active drafts do not appear in history.
- Completed and incomplete sessions appear newest first.
- Session detail remains read-only.

## Privacy, password, and delete account

1. Compare the privacy copy on `/onboarding` and `/settings`.
2. Change the password from `/settings`.
3. Open the delete-account confirmation dialog and verify the permanence copy.
4. In a disposable environment, confirm delete account removes the user and returns the app to login.

Expected:
- Onboarding and settings use the same privacy boundary copy.
- Password errors stay inline if Supabase rejects the change.
- Account deletion only clears local auth after the server returns success.

---
title: How to Recover a Corrupted Game Save
seoTitle: How to Recover a Corrupted Game Save | Save Scum
description: Preserve the damaged save, check game and mod compatibility, find a healthy earlier backup, and restore carefully without promising impossible file repair.
category: RECOVERY / DAMAGED SAVES
order: 4
reviewed: "2026-09-30"
summary: A save that refuses to load is not always beyond help. Preserve the original, rule out compatibility problems, and look for a known-good previous state.
---

A “corrupted save” message can mean several things: damaged contents, an incomplete write, a wrong game version, missing mods, or an unexpected file in the wrong profile. Treat the message as the start of diagnosis, not proof that the only solution is deleting the folder.

## Preserve the current files before experimenting

Exit the game and copy the complete save directory to a separate location. Keep the damaged files as well as any backups beside them. Note the exact error, the last successful session, and what changed since then: a crash, power interruption, update, or mod change.

Avoid repeatedly saving over the same files. If storage itself seems unreliable, prioritize preserving readable data on a separate device before continuing gameplay.

## Check compatibility and the selected profile

Use the game publisher’s support instructions. Confirm that you are opening the correct profile and that the game can still access the documented save path. If the failure followed a mod change, record the previous mod versions and dependencies before altering anything else.

A backup of the save directory does not contain the entire game executable or mod installation. Loading older files in a different environment may still fail. Restoring compatible game or mod versions may be part of the publisher’s recommended process, but do not downgrade blindly.

Game-install integrity checks and save-file recovery are different jobs. Repairing installed assets is not a promise to reconstruct missing character progress.

## Find the newest healthy earlier copy

Look for another manual slot, a rotating autosave, a game-created backup, a separate manual copy, or a backup system configured before the problem. Work through the [overwritten-save recovery checklist](/guides/how-to-restore-overwritten-game-save/) for system-history and cloud considerations.

Prefer a copy from before the first symptoms, not merely the latest timestamp. A newer backup can faithfully preserve a corrupted file. Keep several candidate versions separate so you can test them without losing the alternatives.

Do not rename files based only on a generic internet recipe. Save naming, file sets, and validation differ between games. The developer’s format-specific instructions take priority.

## Restore a known-good snapshot

If Save Scum had already captured a healthy version, choose that snapshot in the game’s history. Close the game, review the path and file changes, and follow the restore confirmation. The current files are preserved first, so the attempted rollback has a safety checkpoint too.

After the restore, review the result and test the game. If it still refuses to load, preserve that result and investigate compatibility rather than rapidly trying every old version over the live directory. Keep cloud synchronization in mind when the restored state differs from another device.

Save Scum verifies the bytes it stored. It does **not** understand every game’s internal save format or prove that captured progress is logically healthy. [Learn what a snapshot actually records.](/guides/game-save-version-control/)

## Know when a repair is outside the tool’s scope

Save Scum restores existing captured files; it is not a universal save-file repair program. If all copies contain the same corruption, or there was never an earlier backup, it cannot invent the missing progress. The game developer may have a supported repair process for that format.

For future sessions, keep multiple versions rather than just one newest backup. Create a named checkpoint before updates and mods, verify restores occasionally, and keep an extra copy off the original disk. A longer history gives you more candidates when damage went unnoticed for a while.

---
title: How to Restore an Overwritten Game Save
seoTitle: How to Restore an Overwritten Game Save | Save Scum
description: Check save slots, game-native backups, system history, cloud considerations, and existing snapshots before replacing files after an accidental overwrite.
category: RECOVERY / START HERE
order: 3
reviewed: "2026-09-30"
summary: Stop creating new saves, preserve what you have, and look for an earlier copy. Recovery depends on a previous version existing somewhere—not on installing a new tool.
---

Accidentally saved over the progress you wanted? Start by closing the game and copying the current save directory somewhere separate. Even an unwanted save may be your best remaining copy. Avoid deleting files or repeatedly testing a restore over the only evidence you have.

**Save Scum cannot recover a historical save it never captured.** The same principle applies to any version-history tool: there must be an earlier recorded state to restore.

## Check the game’s own save slots

Look for manual saves, autosaves, rotating quicksaves, alternate character slots, or an in-game chapter selection. Read the game’s loading interface carefully before assuming the visible newest save is the only one.

If opening the game automatically writes progress, consult the developer’s guidance first and keep your separate file copy. A different slot may be older than ideal but still better than starting over.

## Look for game-created backup files

Check the publisher’s documentation for backup naming and recovery instructions. Some games keep older copies next to their current saves; others do not. A filename ending in `.bak` or `old` is a clue to investigate, not permission to rename it blindly.

Work from copies. Preserve related files together when the save format uses several files, and use the game-specific replacement procedure. Restoring just one member of a related set may leave an inconsistent state.

## Consider cloud copies carefully

A cloud service may already have synchronized the overwrite. An offline device or retained service version could still hold a different state, but do not reconnect it or resolve conflicts casually before checking what is available.

Valve warns that cloud save recovery can be limited in its [Steam Cloud support guidance](https://help.steampowered.com/en/faqs/view/68D2-35AB-09A9-7678). Keep local copies and follow the relevant provider’s instructions. [Our Steam guide](/guides/how-to-back-up-steam-saves/) explains how synchronization fits alongside backups.

## Check system backups made beforehand

On Windows, [File History](https://support.microsoft.com/en-us/windows/experience/backup-recovery/backup-and-restore-with-file-history) may contain older versions if it was enabled and included the save location. Inspect available versions and restore to a separate location when possible. Turning it on now does not populate yesterday’s history.

On macOS, check [existing Time Machine backups](https://support.apple.com/guide/mac-help/restore-items-backed-up-with-time-machine-mh11422/mac) for the relevant directory and date. On Linux, inspect whatever backup or filesystem snapshot system you had already configured. Do not assume an operating system automatically retained every game save.

## Use an existing Save Scum snapshot

If Save Scum was monitoring the right folder before the overwrite, open that game’s history and select a snapshot from before the unwanted change. Review its files and destination path. Close the game before confirming the restore.

The app stages the selected files and preserves your current state in a protected safety checkpoint first. Review the restore result, then launch the game and confirm the expected progress. Keep the original recovery directory until you are satisfied. [Read the restore safeguards](/features/#restore).

## If no earlier version exists

A backup tool cannot reconstruct unrecorded game history. File-recovery software is a different category and may not help after an actual overwrite; results depend on the storage device and what changed. Be cautious about promises of guaranteed recovery.

For deleted files, also check the Recycle Bin or Trash if the deletion went through them, but do not expect an in-game overwrite to appear there. Ask the game developer about format-specific recovery options before risking your remaining files.

Once you have protected the best remaining state, build a [game save backup routine](/guides/how-to-back-up-game-saves/) with dated copies, automatic history where available, and a separate-device backup. The next mistake should have a checkpoint waiting for it.

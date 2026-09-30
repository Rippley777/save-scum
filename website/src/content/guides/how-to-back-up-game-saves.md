---
title: How to Back Up Game Saves on PC
seoTitle: How to Back Up Game Saves on PC | Save Scum
description: Find your game’s actual save folder, create useful manual backups, and build an automatic local backup routine with restore checks and a separate copy.
category: BACKUP BASICS
order: 1
reviewed: "2026-09-30"
summary: A backup should contain the right files, keep the versions you care about, and give you a way to prove they work. Here is a routine you can actually use.
---

An hour of progress is easy to lose and hard to recreate. Before a mod install, a major update, or a questionable in-game choice, preserve a copy of the save you would want back. The first step is finding the files that actually contain it.

## Find the real save directory

The game’s installation directory and its save directory are often different. Start with the publisher’s support page or the game’s documentation. Common starting points include Documents, Saved Games, AppData on Windows, application-support folders on macOS, and configuration folders or Proton prefixes on Linux. These are places to investigate, not universal instructions.

Make a normal in-game save, note the time, and exit the game. Check which files changed at the documented location. If there are several profiles, make sure you selected yours. Some games need a group of related files rather than one obvious `.sav` file. Preserve the whole relevant directory unless the developer says otherwise.

Save Scum includes [folder discovery hints for selected games](/games/), but detection still needs this sanity check.

## Make a manual backup you can recognize

1. Close the game so it is no longer writing files.
2. Copy the save directory to a separate, dated folder outside the live save path.
3. Name the copy with the game, date, and reason: `Before-mod-install` is more useful than `backup-final-3`.
4. Confirm the copied folder contains the expected files. A directory name alone is not evidence of a successful copy.
5. Keep another copy on a separate device if the progress matters to you.

Do not move the live folder when you mean to copy it. Keep older backup folders until you have tested a newer one. Record important game and mod versions alongside the copy; restored files may depend on the same environment.

Manual backups are straightforward and require no extra software. Their weak point is remembering to make one before—not after—the mistake.

## Let automatic local backups keep the routine

A folder watcher can preserve new states while you play. In the Save Scum desktop app, register the actual save folder, inspect the first snapshot, and leave monitoring enabled. Subsequent stable file changes create automatic snapshots. Named checkpoints preserve deliberate milestones.

Check the app’s reported status occasionally. A paused watcher, inaccessible directory, or full drive cannot preserve new progress. Automatic backup is a process worth verifying, not a guarantee that every second is recorded. [See the complete setup walkthrough.](/how-it-works/)

## Use cloud sync for its own job

Synchronization is useful when moving between devices. Version history is useful when the latest state is the wrong one. A service may offer history, but check its actual retention and restore behavior instead of assuming that “in the cloud” means every past save survives.

For Steam-specific considerations, read [how to back up Steam game saves](/guides/how-to-back-up-steam-saves/). An additional independent copy is helpful even when you also use sync.

## Test your way back

Keep a separate copy of current files before any restore test. Close the game, restore a known backup using the documented workflow, and confirm that the expected profile and progress load. Check cloud conflicts carefully. If the game rejects the save, investigate paths, versions, and mods before replacing more files.

A useful backup routine has three parts: the right folder, multiple moments worth keeping, and a restore you have checked. Local version history helps with unwanted changes; a separate-device copy helps when the original disk is lost or fails.

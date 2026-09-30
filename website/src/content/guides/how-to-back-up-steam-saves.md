---
title: How to Back Up Steam Game Saves
seoTitle: How to Back Up Steam Game Saves Automatically | Save Scum
description: Understand Steam Cloud, locate your game’s local save files, and preserve independent copies or automatic local snapshots without confusing sync with history.
category: STEAM & LOCAL SAVES
order: 2
reviewed: "2026-09-30"
summary: Steam Cloud is useful. So is keeping your own history. Understand where each fits before you trust your only copy of a long-running campaign.
---

A Steam library contains games from many developers, with different save locations and cloud behavior. There is no single save-folder rule that works for every title. The reliable approach starts with the game, then adds a backup routine you control.

## Check the game’s cloud behavior

Not every Steam game uses Steam Cloud. Valve explains how to check cloud support and how synchronization conflicts arise in its [Steam Cloud documentation](https://help.steampowered.com/en/faqs/view/68D2-35AB-09A9-7678). A current cloud copy is not a promise of a browsable history of every save.

Before changing sync settings or resolving a conflict, preserve separate copies of the files you have. Compare the states you actually want to keep rather than choosing a side just because its timestamp is newer. If a game has specific restoration guidance, follow it.

## Find local progress, not just installed game files

Consult the game developer’s documentation for its save location. Saves can live under a user profile, Documents, AppData, Steam userdata, or a Proton prefix. An external Steam library may change installation paths without moving all save data beside it.

Valve also distinguishes game-file backups from game-specific saved progress in its [Steam backup feature guidance](https://help.steampowered.com/en/faqs/view/4593-5CB7-DC3C-64F0). Do not assume an installation backup includes every file needed to restore your character or world.

Make an in-game save, exit normally, and check the expected directory for recent changes. Include the correct account, profile, and any related world files. If you cannot identify the directory confidently, ask the publisher before replacing files.

## Keep an independent manual copy

With the game closed, copy the complete relevant save directory to a dated folder outside the live path. Include a short note about game version, mods, and the event you are backing up before. Keep more than one dated copy; overwriting the same backup every time gives you the same one-version problem.

Copy a valuable backup to another storage device as well. A second folder on the same failing disk will not help when the disk itself stops working.

## Automate local save history

Save Scum’s desktop app can monitor a local directory regardless of the store the game came from. Its Steam detection is a convenience for finding installed titles, not a Steam account integration. When a save location is unknown, you must choose the directory yourself.

After registration, inspect the first snapshot and verify the folder contains your progress. Leave monitoring enabled while playing. Create a named checkpoint before a risky mod or game update. [Read the automatic-backup setup instructions](/how-it-works/) and check [current platform availability](/download/).

This does not back up unsaved game memory, online-only progress, or your whole game installation. A snapshot preserves the local files it captured.

## Restore without guessing about synchronization

Close the game, keep a copy of the current local state, and follow the appropriate restore workflow. Afterward, check any synchronization conflict against the version you intended to restore. Avoid launching several devices into the same uncertain state while diagnosing a problem.

If the unwanted save already replaced your progress, use the [overwritten-save recovery guide](/guides/how-to-restore-overwritten-game-save/) to look for existing earlier copies. Installing a backup tool after the fact cannot recreate a version that was never captured.

Save Scum is independent software from Rippley Labs. It is not affiliated with Valve or Steam. Cloud sync and local version history can be complementary parts of a backup routine.

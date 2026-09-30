export const features = [
  {
    icon: "watch",
    title: "Automatic snapshots",
    text: "Save Scum watches your configured folders and captures changed files after activity settles. Keep playing. It keeps the history.",
    detail: "No manual copying. No SAVE_BACKUP_FINAL_FINAL_REAL.",
    href: "/how-it-works/",
  },
  {
    icon: "history",
    title: "A timeline. Not a guessing game.",
    text: "Browse snapshots, compare file changes, and pick the moment you want back. A protected checkpoint preserves your current files before a restore.",
    detail: "Even going backward has an undo plan.",
    href: "/guides/how-to-restore-overwritten-game-save/",
  },
  {
    icon: "flag",
    title: "Name the moment.",
    text: "Create a manual checkpoint before a boss, a respec, or an ambitious mod install. Labels, notes, and favorites make the good saves easy to find.",
    detail: "“I have a bad feeling about this” is a perfectly good name.",
    href: "/features/#checkpoints",
  },
];
export const faq = [
  {
    question: "Can Save Scum restore an overwritten save?",
    answer:
      "Yes, if a usable earlier snapshot was captured before the overwrite. It cannot recover history it never saved. If you have already lost progress, check game-native backups, other save slots, and existing system backups first.",
    href: "/guides/how-to-restore-overwritten-game-save/",
    link: "Work through the overwritten-save recovery guide",
  },
  {
    question: "Does it replace Steam Cloud?",
    answer:
      "No. Cloud sync helps move current saves between devices; Save Scum keeps local historical states. They solve different problems. Review sync conflicts carefully after a restore, and keep a separate copy of the state you want.",
    href: "/guides/how-to-back-up-steam-saves/",
    link: "Read about Steam save backups",
  },
  {
    question: "Where are PC game saves stored?",
    answer:
      "It depends on the game and platform. Common places include Documents, AppData, Saved Games, Steam userdata, and Linux Proton prefixes. The install folder is often not the save folder. Confirm the location with the game’s documentation and a recent save.",
    href: "/games/",
    link: "Find save-folder guidance",
  },
  {
    question: "Does Save Scum upload my saves?",
    answer:
      "No. The desktop app stores snapshots on storage you control. It needs no account, telemetry service, or subscription, and no cloud integration is included. Keep an additional copy on a separate device for drive failure protection.",
  },
  {
    question: "Does it work without Steam or an internet connection?",
    answer:
      "Yes. The desktop app monitors ordinary local directories and operates offline. Steam discovery is a convenience, not an account integration or a requirement. Server-side progress that is never saved locally is outside its scope.",
  },
  {
    question: "How much disk space will it use?",
    answer:
      "It depends on save sizes and how often files change. Unchanged files are shared between snapshots; stored files are compressed. Retention can expire eligible automatic snapshots, while manual checkpoints and panic saves are preserved. Leave free space for restore staging and recovery copies.",
    href: "/features/#storage",
    link: "Understand snapshot storage",
  },
  {
    question: "Which platforms can I download it for?",
    answer:
      "Public installers are not listed yet. Version 0.1.0 has a local macOS development build; it is not a notarized release. Windows and Linux are targets pending platform verification. Tray and global shortcut behavior can vary by desktop environment.",
    href: "/download/",
    link: "Check release and platform status",
  },
  {
    question: "Can it repair a corrupted save?",
    answer:
      "Save Scum restores captured files; it does not repair a game’s save format. A healthy older snapshot may help. If every available copy is corrupted, installing Save Scum now cannot reconstruct the missing progress.",
    href: "/guides/how-to-recover-corrupted-game-save/",
    link: "Check your corrupted-save recovery options",
  },
];
export const useCases = [
  [
    "The mod broke everything.",
    "Return to a checkpoint from before the install. You may also need the matching game and mod versions.",
  ],
  [
    "That dialogue option was a mistake.",
    "Pick an earlier captured save and try a less catastrophic conversation.",
  ],
  [
    "Your save stopped loading.",
    "Restore a known-good snapshot. Corrupted files themselves are not magically repaired.",
  ],
  [
    "The game gives you one save slot.",
    "Keep multiple captured versions outside the game’s own slot system.",
  ],
  [
    "You want to experiment.",
    "Name a checkpoint. Try the strange build. See what happens.",
  ],
  [
    "You are about to pull that lever.",
    "Panic Save first. Deeply questionable decision second.",
  ],
];

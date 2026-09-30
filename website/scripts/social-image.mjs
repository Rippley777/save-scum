import sharp from "sharp";
import { mkdir } from "node:fs/promises";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#101310"/><path d="M0 590h1200" stroke="#35412c"/>
<rect x="60" y="62" width="45" height="45" rx="12" fill="#c0e994"/><path d="M73 74h17l5 5v17H72V74h1Zm5 0v8h11v-8M78 96V85h11v11" fill="none" stroke="#16220f" stroke-width="2.5"/>
<text x="122" y="95" fill="#e9eee4" font-family="Arial,sans-serif" font-size="27" font-weight="700" letter-spacing="2">SAVE SCUM.</text>
<text x="60" y="196" fill="#bdcfac" font-family="monospace" font-size="14" letter-spacing="2">AUTOMATIC GAME SAVE BACKUP</text>
<text x="55" y="275" fill="#f0f3ec" font-family="Arial,sans-serif" font-size="61" font-weight="700" letter-spacing="-3">Git for your</text><text x="55" y="349" fill="#c0e994" font-family="Arial,sans-serif" font-size="61" font-weight="700" letter-spacing="-3">game saves.</text>
<text x="60" y="412" fill="#b4c2a8" font-family="Arial,sans-serif" font-size="20">Your bad decisions are reversible.</text><text x="60" y="487" fill="#afc49d" font-family="monospace" font-size="13">LOCAL-FIRST. NO ACCOUNT. NO SUBSCRIPTION.</text>
<rect x="649" y="88" width="490" height="452" rx="14" fill="#1a2116" stroke="#4b6139"/><path d="M649 136h490" stroke="#39492c"/><circle cx="673" cy="112" r="5" fill="#ad8170"/><circle cx="690" cy="112" r="5" fill="#b2a277"/><circle cx="707" cy="112" r="5" fill="#94b274"/><text x="1120" y="116" text-anchor="end" fill="#b3c3a5" font-family="monospace" font-size="12">ILLUSTRATIVE TIMELINE</text>
<text x="682" y="185" fill="#eef3e6" font-family="Arial,sans-serif" font-size="23" font-weight="700">Your save history</text><path d="M698 220v230" stroke="#67824d" stroke-width="2"/>
<circle cx="698" cy="247" r="10" fill="#c0e994"/><rect x="727" y="217" width="378" height="70" rx="7" fill="#24301c" stroke="#435a30"/><text x="746" y="247" fill="#e2ebd9" font-family="Arial,sans-serif" font-size="18">Automatic snapshot</text><text x="746" y="271" fill="#b1c59f" font-family="monospace" font-size="11">10:42 PM · 3 files changed</text>
<circle cx="698" cy="339" r="10" fill="#e5cc8c"/><rect x="727" y="309" width="378" height="70" rx="7" fill="#2d2c1e" stroke="#6b613e"/><text x="746" y="339" fill="#efdfa9" font-family="Arial,sans-serif" font-size="18">★ Before Boss</text><text x="746" y="363" fill="#c6b991" font-family="monospace" font-size="11">10:17 PM · Manual checkpoint</text>
<circle cx="698" cy="431" r="10" fill="#e6ad8a"/><rect x="727" y="401" width="378" height="70" rx="7" fill="#30251c" stroke="#6e4930"/><text x="746" y="431" fill="#efbe9c" font-family="Arial,sans-serif" font-size="18">! PANIC SAVE</text><text x="746" y="455" fill="#c6ae98" font-family="monospace" font-size="11">Bad idea detected. Evidence preserved.</text>
<text x="60" y="615" fill="#95aa84" font-family="monospace" font-size="12">AN INDEPENDENT UTILITY BY RIPPLEY LABS</text></svg>`;
await mkdir(new URL("../public/social/", import.meta.url), { recursive: true });
await sharp(Buffer.from(svg))
  .png()
  .toFile(
    new URL("../public/social/save-scum-game-save-history.png", import.meta.url)
      .pathname,
  );
console.log(
  "Generated 1200 × 630 social card from the site’s own vector design.",
);

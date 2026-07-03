const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const HTML_FILES = [
  'index.html',
  path.join('(tabs)', 'index.html'),
];

const seoBlock = String.raw`
<main id="seo-content" class="seo-content" aria-label="Wordle Unlimited Party overview">
  <header class="seo-hero">
    <h1>Wordle Unlimited Party</h1>
    <p>Play unlimited multiplayer Wordle online with friends. Create a party room, share the link, talk with voice chat, and solve word puzzles together in real time.</p>
  </header>
  <section>
    <h2>Game Modes</h2>
    <p>Choose solo mode for a classic unlimited Wordle game, or party mode to play with friends using shared boards, private boards, room codes, and invite links.</p>
  </section>
  <section>
    <h2>How to Play</h2>
    <p>Guess the hidden five-letter word. Green letters are correct, yellow letters are in the word but placed differently, and dark letters are not in the answer.</p>
  </section>
  <section>
    <h2>Features</h2>
    <ul>
      <li>Unlimited Wordle puzzles with no login required.</li>
      <li>Real-time multiplayer party rooms for friends.</li>
      <li>Optional LiveKit voice chat while playing.</li>
      <li>Shared boards, individual boards, hints, answer meanings, and statistics.</li>
      <li>Multiple difficulty levels for casual and serious word game players.</li>
    </ul>
  </section>
  <section>
    <h2>FAQ</h2>
    <p><strong>Is Wordle Unlimited Party free?</strong> Yes, it is free to play online.</p>
    <p><strong>Can I play with friends?</strong> Yes, create a party room and share the room link or code.</p>
    <p><strong>Do I need an account?</strong> No account is required to start playing.</p>
  </section>
</main>`;

const seoStyle = String.raw`
<style id="seo-content-style">
  .seo-content{box-sizing:border-box;background:#071018;color:#e5edf6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55;padding:32px 20px;max-width:960px;margin:0 auto}
  .seo-content *{box-sizing:border-box}
  .seo-content h1{font-size:40px;line-height:1.05;margin:0 0 12px;font-weight:900;color:#f8fafc}
  .seo-content h2{font-size:22px;margin:28px 0 8px;font-weight:900;color:#22c55e}
  .seo-content p{font-size:16px;margin:0 0 10px;color:#cbd5e1}
  .seo-content ul{margin:8px 0 0;padding-left:22px;color:#cbd5e1}
  .seo-content li{margin:6px 0}
  .seo-hero{border-bottom:1px solid #1f2937;padding-bottom:22px;margin-bottom:18px}
  .js-ready .seo-content{display:none}
</style>`;

const hideAfterHydrationScript = String.raw`
<script id="seo-content-hydration-guard">
  document.documentElement.classList.add('js-ready');
</script>`;

for (const relativeFile of HTML_FILES) {
  const filePath = path.join(DIST_DIR, relativeFile);
  if (!fs.existsSync(filePath)) continue;

  let html = fs.readFileSync(filePath, 'utf8');
  html = html
    .replace(/<main id="seo-content"[\s\S]*?<\/main>/, '')
    .replace(/<style id="seo-content-style">[\s\S]*?<\/style>/, '')
    .replace(/<script id="seo-content-hydration-guard">[\s\S]*?<\/script>/, '');

  if (!html.includes('<div id="root"')) {
    throw new Error(`Could not find root element in ${relativeFile}`);
  }

  html = html.replace('</head>', `${seoStyle}</head>`);
  html = html.replace('<div id="root"', `${seoBlock}<div id="root"`);
  html = html.replace('</body>', `${hideAfterHydrationScript}</body>`);
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`Injected semantic SEO HTML into ${relativeFile}`);
}

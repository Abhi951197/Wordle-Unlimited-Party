const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const SITE_URL = 'https://wordle-unlimited-party.vercel.app';
const SITE_NAME = 'Wordle Unlimited Party';
const SITE_TITLE = 'Wordle Unlimited Party – Multiplayer Word Game';
const SITE_DESCRIPTION = 'Play Wordle Unlimited Party online with friends. Enjoy unlimited puzzles, real-time multiplayer, voice chat, hints, and multiple difficulty levels for free.';

const websiteStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  alternateName: 'Wordle Party',
  url: `${SITE_URL}/`,
};

function upsertMeta(html, attr, value, tag) {
  const pattern = new RegExp(`<meta\\s+${attr}=["']${value}["'][^>]*>`, 'i');
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace('</head>', `${tag}</head>`);
}

function ensureHeadSignals(html) {
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${SITE_TITLE}</title>`);
  if (!/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace('</head>', `<title>${SITE_TITLE}</title></head>`);
  }

  html = upsertMeta(html, 'name', 'description', `<meta name="description" content="${SITE_DESCRIPTION}">`);
  html = upsertMeta(html, 'name', 'application-name', `<meta name="application-name" content="${SITE_NAME}">`);
  html = upsertMeta(html, 'property', 'og:site_name', `<meta property="og:site_name" content="${SITE_NAME}">`);
  html = upsertMeta(html, 'property', 'og:title', `<meta property="og:title" content="${SITE_TITLE}">`);

  if (!html.includes('"@type":"WebSite"') && !html.includes('"@type": "WebSite"')) {
    html = html.replace(
      '</head>',
      `<script type="application/ld+json">${JSON.stringify(websiteStructuredData)}</script></head>`
    );
  }

  return html;
}

const pages = [
  {
    files: ['index.html', path.join('(tabs)', 'index.html')],
    label: 'Wordle Unlimited Party overview',
    html: String.raw`
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
    <h2>More Pages</h2>
    <ul>
      <li><a href="/how-to-play">How to Play</a></li>
      <li><a href="/features">Features</a></li>
      <li><a href="/leaderboard">Leaderboard</a></li>
      <li><a href="/privacy">Privacy Policy</a></li>
      <li><a href="/terms">Terms of Use</a></li>
      <li><a href="/contact">Contact</a></li>
    </ul>
  </section>
</main>`,
  },
  {
    files: ['how-to-play.html'],
    label: 'How to play Wordle Unlimited Party',
    html: String.raw`
<main id="seo-content" class="seo-content" aria-label="How to play Wordle Unlimited Party">
  <header class="seo-hero">
    <h1>How to Play Wordle Unlimited Party</h1>
    <p>Learn how to play Wordle Unlimited Party, read color clues, use hints, and play solo or multiplayer word games online.</p>
  </header>
  <section><h2>Basic Rules</h2><p>Guess the hidden five-letter word before you run out of guesses. Green letters are correct, yellow letters are in the word but placed differently, and dark letters are not in the answer.</p></section>
  <section><h2>Solo Mode</h2><p>Solo mode is a classic unlimited Wordle experience with difficulty levels and statistics.</p></section>
  <section><h2>Party Mode</h2><p>Party mode lets friends join the same room, use shared or private boards, and optionally talk with voice chat.</p></section>
</main>`,
  },
  {
    files: ['features.html'],
    label: 'Wordle Unlimited Party features',
    html: String.raw`
<main id="seo-content" class="seo-content" aria-label="Wordle Unlimited Party features">
  <header class="seo-hero"><h1>Wordle Unlimited Party Features</h1><p>Explore multiplayer rooms, voice chat, shared boards, hints, meanings, statistics, and difficulty levels.</p></header>
  <section><h2>Multiplayer Rooms</h2><p>Create a room, share a code or invite link, and play Wordle online with friends from different devices.</p></section>
  <section><h2>Shared and Individual Boards</h2><p>Use shared boards to solve together or individual boards while staying in the same party room.</p></section>
  <section><h2>Learning Tools</h2><p>Hints, answer meanings, statistics, and difficulty levels help casual and serious word game players.</p></section>
</main>`,
  },
  {
    files: ['leaderboard.html'],
    label: 'Wordle Unlimited Party leaderboard',
    html: String.raw`
<main id="seo-content" class="seo-content" aria-label="Wordle Unlimited Party leaderboard">
  <header class="seo-hero"><h1>Wordle Unlimited Party Leaderboard</h1><p>Compete on a no-login Wordle leaderboard with unique usernames, difficulty rankings, streaks, win rates, and transparent scoring rules.</p></header>
  <section><h2>No-Login Rankings</h2><p>Players choose a unique public username once and can appear on global rankings without creating an account.</p></section>
  <section><h2>Scoring Rules</h2><p>Wins earn base points by difficulty, plus efficiency and no-hint bonuses. Hint-assisted games still count but receive a smaller score.</p></section>
  <section><h2>Difficulty Tabs</h2><p>Overall, Easy, Moderate, Difficult, and Prodigy leaderboards help players compare fairly.</p></section>
</main>`,
  },
  {
    files: ['privacy.html'],
    label: 'Wordle Unlimited Party privacy policy',
    html: String.raw`
<main id="seo-content" class="seo-content" aria-label="Wordle Unlimited Party privacy policy">
  <header class="seo-hero"><h1>Privacy Policy</h1><p>Learn how Wordle Unlimited Party uses gameplay data, room information, analytics, voice chat, and local storage.</p></header>
  <section><h2>Gameplay Data</h2><p>The app uses guesses, room codes, player names, emoji choices, difficulty, and statistics to run the game.</p></section>
  <section><h2>Local Storage</h2><p>Recent rooms, settings, and statistics may be stored on your device.</p></section>
  <section><h2>Voice Chat</h2><p>Voice chat is optional and microphone access is requested only when you choose to join voice.</p></section>
</main>`,
  },
  {
    files: ['terms.html'],
    label: 'Wordle Unlimited Party terms of use',
    html: String.raw`
<main id="seo-content" class="seo-content" aria-label="Wordle Unlimited Party terms of use">
  <header class="seo-hero"><h1>Terms of Use</h1><p>Read the terms for playing Wordle Unlimited Party, using party rooms, voice chat, and online word game features.</p></header>
  <section><h2>Use of the App</h2><p>Wordle Unlimited Party is an online word game for entertainment and learning.</p></section>
  <section><h2>Player Conduct</h2><p>Use respectful names, chat messages, and voice communication. Do not spam or disrupt rooms.</p></section>
  <section><h2>Availability</h2><p>Rooms and sessions are best-effort features and may reset during maintenance or deployments.</p></section>
</main>`,
  },
  {
    files: ['contact.html'],
    label: 'Contact Wordle Unlimited Party',
    html: String.raw`
<main id="seo-content" class="seo-content" aria-label="Contact Wordle Unlimited Party">
  <header class="seo-hero"><h1>Contact Wordle Unlimited Party</h1><p>Send feedback, bug reports, SEO questions, and multiplayer word game improvement ideas.</p></header>
  <section><h2>Feedback</h2><p>Share feedback about gameplay, multiplayer rooms, voice chat, hints, design, or mobile responsiveness.</p></section>
  <section><h2>Bug Reports</h2><p>Include your device, browser, room mode, and the action that caused the issue.</p></section>
  <section><h2>Search and Indexing</h2><p>This page helps users and search engines find project contact information without running the game UI first.</p></section>
</main>`,
  },
];

const seoStyle = String.raw`
<style id="seo-content-style">
  .seo-content{box-sizing:border-box;background:#071018;color:#e5edf6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55;padding:32px 20px;max-width:960px;margin:0 auto}
  .seo-content *{box-sizing:border-box}
  .seo-content h1{font-size:40px;line-height:1.05;margin:0 0 12px;font-weight:900;color:#f8fafc}
  .seo-content h2{font-size:22px;margin:28px 0 8px;font-weight:900;color:#22c55e}
  .seo-content p{font-size:16px;margin:0 0 10px;color:#cbd5e1}
  .seo-content a{color:#60a5fa;font-weight:800}
  .seo-content ul{margin:8px 0 0;padding-left:22px;color:#cbd5e1}
  .seo-content li{margin:6px 0}
  .seo-hero{border-bottom:1px solid #1f2937;padding-bottom:22px;margin-bottom:18px}
  .js-ready .seo-content{display:none}
</style>`;

const hideAfterHydrationScript = String.raw`
<script id="seo-content-hydration-guard">
  document.documentElement.classList.add('js-ready');
</script>`;

for (const page of pages) {
  for (const relativeFile of page.files) {
    const filePath = path.join(DIST_DIR, relativeFile);
    if (!fs.existsSync(filePath)) continue;

    let html = fs.readFileSync(filePath, 'utf8');
    html = ensureHeadSignals(html);
    html = html
      .replace(/<main id="seo-content"[\s\S]*?<\/main>/, '')
      .replace(/<style id="seo-content-style">[\s\S]*?<\/style>/, '')
      .replace(/<script id="seo-content-hydration-guard">[\s\S]*?<\/script>/, '');

    if (!html.includes('<div id="root"')) {
      throw new Error(`Could not find root element in ${relativeFile}`);
    }

    html = html.replace('</head>', `${seoStyle}</head>`);
    html = html.replace('<div id="root"', `${page.html}<div id="root"`);
    html = html.replace('</body>', `${hideAfterHydrationScript}</body>`);
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`Injected semantic SEO HTML into ${relativeFile}`);
  }
}

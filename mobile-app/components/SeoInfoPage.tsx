import React from 'react';
import { Link } from 'expo-router';
import Head from 'expo-router/head';
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

const SITE_URL = 'https://wordle-unlimited-party.vercel.app';

type Section = {
  title: string;
  body: string;
  items?: string[];
};

type SeoInfoPageProps = {
  path: string;
  title: string;
  description: string;
  eyebrow: string;
  sections: Section[];
};

const navItems = [
  { href: '/', label: 'Play' },
  { href: '/how-to-play', label: 'How to Play' },
  { href: '/features', label: 'Features' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/contact', label: 'Contact' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
];

const pageArt: Record<string, { icon: string; accent: string; image?: string; note: string }> = {
  '/how-to-play': { icon: '💡', accent: '#FACC15', note: 'Master the rules in minutes.' },
  '/features': { icon: '👑', accent: '#22C55E', image: '/party-illustration.png', note: 'Built for solo focus and friend sessions.' },
  '/leaderboard': { icon: '🏆', accent: '#FACC15', note: 'Climb the rankings without creating an account.' },
  '/privacy': { icon: '🔒', accent: '#22C55E', note: 'Clear, minimal, and respectful.' },
  '/terms': { icon: '🛡️', accent: '#8B5CF6', note: 'Simple rules for fair play.' },
  '/contact': { icon: '✉️', accent: '#A855F7', note: 'Feedback, bugs, ideas, and SEO questions.' },
};

function MiniLogo() {
  const tiles = [
    ['W', '#22C55E'],
    ['O', '#FBBF24'],
    ['R', '#8B5CF6'],
    ['D', '#22C55E'],
  ];

  return (
    <View style={styles.logoRow}>
      <View style={styles.logoTiles}>
        {tiles.map(([letter, color]) => (
          <View key={letter} style={[styles.logoTile, { backgroundColor: color }]}>
            <Text style={styles.logoTileText}>{letter}</Text>
          </View>
        ))}
      </View>
      <View>
        <Text style={styles.logoName}>WORDLE</Text>
        <Text style={styles.logoSub}>Unlimited Party</Text>
      </View>
    </View>
  );
}

function WordSample() {
  const letters = [
    ['W', '#22C55E'],
    ['O', '#22C55E'],
    ['R', '#FBBF24'],
    ['D', '#374151'],
    ['L', '#22C55E'],
    ['E', '#374151'],
  ];
  return (
    <View style={styles.wordSample}>
      {letters.map(([letter, color], index) => (
        <View key={`${letter}-${index}`} style={[styles.wordTile, { backgroundColor: color }]}>
          <Text style={styles.wordTileText}>{letter}</Text>
        </View>
      ))}
    </View>
  );
}

export function SeoInfoPage({ path, title, description, eyebrow, sections }: SeoInfoPageProps) {
  const canonical = `${SITE_URL}${path}`;
  const cleanTitle = title.replace(' - Wordle Unlimited Party', '');
  const art = pageArt[path] ?? pageArt['/features'];
  const { width } = useWindowDimensions();
  const compact = width < 760;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="robots" content="index,follow" />
        <meta name="application-name" content="Wordle Unlimited Party" />
        <link rel="canonical" href={canonical} />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/favicon.png" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:site_name" content="Wordle Unlimited Party" />
        <meta property="og:image" content={`${SITE_URL}/party-illustration.png`} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={`${SITE_URL}/party-illustration.png`} />
      </Head>

      <View style={styles.glowA} />
      <View style={styles.glowB} />

      <View style={styles.shell}>
        <View style={[styles.topBar, compact && styles.topBarCompact]}>
          <Link href="/" style={styles.logoLink}>
            <MiniLogo />
          </Link>
          <View style={[styles.nav, compact && styles.navCompact]}>
            {navItems.map(item => (
              <Link
                key={item.href}
                href={item.href as never}
                style={[styles.navLink, path === item.href && styles.navLinkActive]}
              >
                {item.label}
              </Link>
            ))}
          </View>
        </View>

        <View style={[styles.mainGrid, compact && styles.mainGridCompact]}>
          {!compact && <View style={styles.sidebar}>
            <MiniLogo />
            <View style={styles.sideNav}>
              {navItems.map((item, index) => (
                <Link key={item.href} href={item.href as never} style={[styles.sideLink, path === item.href && styles.sideLinkActive]}>
                  <Text style={styles.sideNumber}>{index + 1}</Text>
                  <Text style={styles.sideLabel}>{item.label}</Text>
                </Link>
              ))}
            </View>
            <View style={styles.statusBox}>
              <View style={styles.statusDot} />
              <View>
                <Text style={styles.statusTitle}>Online</Text>
                <Text style={styles.statusText}>Join a party anytime</Text>
              </View>
            </View>
          </View>}

          <View style={[styles.pagePanel, compact && styles.pagePanelCompact]}>
            <View style={[styles.hero, compact && styles.heroCompact]}>
              <View style={styles.heroCopy}>
                <Link href="/" style={styles.backLink}>← Back to Game</Link>
                <Text style={[styles.eyebrow, { color: art.accent }]}>{eyebrow}</Text>
                <Text accessibilityRole="header" style={[styles.title, compact && styles.titleCompact]}>{cleanTitle}</Text>
                <Text style={[styles.description, compact && styles.descriptionCompact]}>{description}</Text>
                <View style={styles.quickStats}>
                  <View style={styles.statPill}><Text style={styles.statIcon}>∞</Text><Text style={styles.statText}>Unlimited</Text></View>
                  <View style={styles.statPill}><Text style={styles.statIcon}>🎙️</Text><Text style={styles.statText}>Voice</Text></View>
                  <View style={styles.statPill}><Text style={styles.statIcon}>👥</Text><Text style={styles.statText}>Party</Text></View>
                </View>
              </View>

              <View style={[styles.heroArt, compact && styles.heroArtCompact, { borderColor: art.accent }]}>
                {art.image ? (
                  <Image source={{ uri: art.image }} style={styles.heroImage} resizeMode="cover" />
                ) : (
                  <>
                    <Text style={styles.heroIcon}>{art.icon}</Text>
                    <WordSample />
                  </>
                )}
                <Text style={styles.heroNote}>{art.note}</Text>
              </View>
            </View>

            <View style={styles.cardGrid}>
              {sections.map((section, index) => (
                <View key={section.title} style={[styles.section, compact && styles.sectionCompact, index === 0 && { borderColor: art.accent }]}>
                  <View style={styles.sectionHeader}>
                    <View style={[styles.sectionBadge, { backgroundColor: `${art.accent}24`, borderColor: art.accent }]}>
                      <Text style={[styles.sectionBadgeText, { color: art.accent }]}>{String(index + 1).padStart(2, '0')}</Text>
                    </View>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                  <Text style={styles.sectionBody}>{section.body}</Text>
                  {section.items?.map(item => (
                    <Text key={item} style={styles.listItem}>✓ {item}</Text>
                  ))}
                </View>
              ))}
            </View>

            {path === '/how-to-play' && (
              <View style={styles.rulePanel}>
                <WordSample />
                <View style={styles.legendRow}>
                  <Text style={styles.legendGreen}>Green: correct spot</Text>
                  <Text style={styles.legendYellow}>Yellow: wrong spot</Text>
                  <Text style={styles.legendDark}>Dark: not in word</Text>
                </View>
              </View>
            )}

            <View style={[styles.footerHero, compact && styles.footerHeroCompact]}>
              <Image source={{ uri: '/brand-logo.png' }} style={styles.footerLogoArt} resizeMode="contain" />
              <View style={styles.footerCopy}>
                <Text style={styles.footerTitle}>Words connect. Games bring us together.</Text>
                <Text style={styles.footerText}>Play unlimited. Stay connected.</Text>
                <Link href="/" style={styles.playButton}>Play Wordle Unlimited Party →</Link>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.footerNav}>
          <Text style={styles.copyright}>© 2026 Wordle Unlimited Party</Text>
          <View style={styles.footerLinks}>
            {navItems.map(item => (
              <Link key={item.href} href={item.href as never} style={styles.footerLink}>{item.label}</Link>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050711' },
  content: { minHeight: '100%', paddingHorizontal: 18, paddingVertical: 22 },
  glowA: { position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(124,58,237,0.22)', top: -140, right: -120 },
  glowB: { position: 'absolute', width: 360, height: 360, borderRadius: 180, backgroundColor: 'rgba(34,197,94,0.12)', bottom: 60, left: -130 },
  shell: { width: '100%', maxWidth: 1240, alignSelf: 'center', gap: 18 },
  topBar: { minHeight: 74, borderWidth: 1, borderColor: '#2A1B55', backgroundColor: 'rgba(8,12,26,0.82)', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
  topBarCompact: { flexDirection: 'column', alignItems: 'flex-start', borderRadius: 20, paddingHorizontal: 14 },
  logoLink: { textDecorationLine: 'none' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoTiles: { width: 42, height: 42, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  logoTile: { width: 20, height: 20, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  logoTileText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  logoName: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  logoSub: { color: '#B8C2D8', fontSize: 11, fontWeight: '800' },
  nav: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 10 },
  navCompact: { justifyContent: 'flex-start', width: '100%', gap: 8 },
  navLink: { color: '#B8C2D8', fontSize: 13, fontWeight: '800', paddingHorizontal: 12, paddingVertical: 8, textDecorationLine: 'none' },
  navLinkActive: { color: '#FFFFFF', backgroundColor: '#311465', borderRadius: 12 },
  mainGrid: { flexDirection: 'row', gap: 18, alignItems: 'stretch' },
  mainGridCompact: { flexDirection: 'column' },
  sidebar: { width: 220, borderWidth: 1, borderColor: '#2A1B55', backgroundColor: 'rgba(8,12,26,0.86)', borderRadius: 24, padding: 18, justifyContent: 'space-between', gap: 24 },
  sidebarCompact: { width: '100%', flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  sideNav: { gap: 8 },
  sideLink: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: 'transparent', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, textDecorationLine: 'none' },
  sideLinkActive: { borderColor: '#7C3AED', backgroundColor: 'rgba(124,58,237,0.26)' },
  sideNumber: { color: '#A78BFA', width: 20, fontSize: 12, fontWeight: '900' },
  sideLabel: { color: '#F8FAFC', fontSize: 13, fontWeight: '900' },
  statusBox: { borderWidth: 1, borderColor: '#1E2A44', backgroundColor: '#0D1728', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22C55E' },
  statusTitle: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  statusText: { color: '#9CA3AF', fontSize: 11, fontWeight: '700' },
  pagePanel: { flex: 1, borderWidth: 1, borderColor: '#6D28D9', backgroundColor: 'rgba(7,12,25,0.92)', borderRadius: 26, padding: 20, gap: 18, overflow: 'hidden' },
  pagePanelCompact: { borderRadius: 22, padding: 14 },
  hero: { flexDirection: 'row', alignItems: 'stretch', gap: 18 },
  heroCompact: { flexDirection: 'column' },
  heroCopy: { flex: 1.1, justifyContent: 'center', gap: 10 },
  backLink: { color: '#A7B3CC', fontSize: 13, fontWeight: '900', textDecorationLine: 'none' },
  eyebrow: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  title: { color: '#FFFFFF', fontSize: 42, lineHeight: 48, fontWeight: '900' },
  titleCompact: { fontSize: 30, lineHeight: 36 },
  description: { color: '#D5DCF0', fontSize: 16, lineHeight: 25, fontWeight: '700', maxWidth: 620 },
  descriptionCompact: { fontSize: 14, lineHeight: 22 },
  quickStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  statPill: { minWidth: 118, borderWidth: 1, borderColor: '#26324D', backgroundColor: '#111B2D', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statIcon: { color: '#F8FAFC', fontSize: 18, fontWeight: '900' },
  statText: { color: '#E5E7EB', fontSize: 12, fontWeight: '900' },
  heroArt: { flex: 0.9, minHeight: 260, borderWidth: 1, backgroundColor: '#10162A', borderRadius: 24, alignItems: 'center', justifyContent: 'center', padding: 18, overflow: 'hidden', gap: 14 },
  heroArtCompact: { minHeight: 210, borderRadius: 20 },
  heroImage: { position: 'absolute', width: '120%', height: '120%', opacity: 0.78 },
  heroIcon: { fontSize: 82 },
  heroNote: { color: '#F8FAFC', fontSize: 14, fontWeight: '900', textAlign: 'center', backgroundColor: 'rgba(5,7,17,0.68)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden' },
  wordSample: { flexDirection: 'row', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  wordTile: { width: 54, height: 54, borderRadius: 10, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  wordTileText: { color: '#FFFFFF', fontSize: 28, fontWeight: '900' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  section: { flexGrow: 1, flexBasis: 250, borderWidth: 1, borderColor: '#202B46', backgroundColor: '#0D1728', borderRadius: 18, padding: 16, gap: 10 },
  sectionCompact: { flexBasis: '100%' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionBadge: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionBadgeText: { fontSize: 12, fontWeight: '900' },
  sectionTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  sectionBody: { color: '#C9D2E6', fontSize: 14, lineHeight: 21, fontWeight: '700' },
  listItem: { color: '#DCE6F8', fontSize: 13, lineHeight: 20, fontWeight: '800' },
  rulePanel: { borderWidth: 1, borderColor: '#2D3A59', backgroundColor: '#0B1324', borderRadius: 20, padding: 18, gap: 14 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  legendGreen: { color: '#86EFAC', fontSize: 12, fontWeight: '900' },
  legendYellow: { color: '#FDE68A', fontSize: 12, fontWeight: '900' },
  legendDark: { color: '#CBD5E1', fontSize: 12, fontWeight: '900' },
  footerHero: { minHeight: 230, borderWidth: 1, borderColor: '#2B2254', backgroundColor: '#0A1020', borderRadius: 24, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 20, overflow: 'hidden' },
  footerHeroCompact: { flexDirection: 'column', alignItems: 'stretch', borderRadius: 20 },
  footerLogoArt: { flex: 1, minHeight: 180 },
  footerCopy: { flex: 1, gap: 10 },
  footerTitle: { color: '#FFFFFF', fontSize: 25, lineHeight: 31, fontWeight: '900' },
  footerText: { color: '#C6D1EA', fontSize: 16, fontWeight: '800' },
  playButton: { alignSelf: 'flex-start', marginTop: 8, color: '#FFFFFF', backgroundColor: '#16A34A', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, fontWeight: '900', textDecorationLine: 'none', overflow: 'hidden' },
  footerNav: { borderWidth: 1, borderColor: '#231A47', backgroundColor: 'rgba(8,12,26,0.82)', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' },
  copyright: { color: '#8792AA', fontSize: 12, fontWeight: '700' },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  footerLink: { color: '#B8C2D8', fontSize: 12, fontWeight: '800', textDecorationLine: 'none' },
});

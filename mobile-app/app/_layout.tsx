import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { Analytics } from '@vercel/analytics/react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { GameStateProvider } from '@/store/GameState';

export const unstable_settings = {
  anchor: '(tabs)',
};

const SITE_URL = 'https://wordle-unlimited-party.vercel.app';
const SITE_TITLE = 'Wordle Unlimited Party - Multiplayer Word Game';
const SITE_DESCRIPTION = 'Play Wordle Unlimited Party online with friends. Enjoy unlimited puzzles, real-time multiplayer, voice chat, hints, and multiple difficulty levels for free.';

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Wordle Unlimited Party',
  applicationCategory: 'GameApplication',
  operatingSystem: 'Web',
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  featureList: [
    'Unlimited Wordle puzzles',
    'Solo and party modes',
    'Real-time multiplayer boards',
    'Live voice chat',
    'Difficulty levels',
    'Hints and answer meanings',
  ],
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GameStateProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Head>
          <title>{SITE_TITLE}</title>
          <meta name="description" content={SITE_DESCRIPTION} />
          <meta name="robots" content="index,follow" />
          <meta name="theme-color" content="#16C75A" />
          <link rel="canonical" href={SITE_URL} />
          <link rel="icon" type="image/png" href="/favicon.png" />
          <link rel="apple-touch-icon" href="/favicon.png" />
          <link rel="manifest" href="/site.webmanifest" />
          <meta name="keywords" content="wordle unlimited, wordle multiplayer, word game online, play wordle with friends, wordle party, voice chat word game" />
          <meta property="og:type" content="website" />
          <meta property="og:title" content={SITE_TITLE} />
          <meta property="og:description" content={SITE_DESCRIPTION} />
          <meta property="og:url" content={SITE_URL} />
          <meta property="og:site_name" content="Wordle Unlimited Party" />
          <meta property="og:image" content={`${SITE_URL}/party-illustration.png`} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={SITE_TITLE} />
          <meta name="twitter:description" content={SITE_DESCRIPTION} />
          <meta name="twitter:image" content={`${SITE_URL}/party-illustration.png`} />
          <script type="application/ld+json">{JSON.stringify(structuredData)}</script>
        </Head>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="how-to-play" options={{ headerShown: false }} />
          <Stack.Screen name="features" options={{ headerShown: false }} />
          <Stack.Screen name="privacy" options={{ headerShown: false }} />
          <Stack.Screen name="terms" options={{ headerShown: false }} />
          <Stack.Screen name="contact" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
        <Analytics />
      </ThemeProvider>
    </GameStateProvider>
  );
}

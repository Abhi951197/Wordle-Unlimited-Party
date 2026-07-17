import React from 'react';
import { Link } from 'expo-router';
import Head from 'expo-router/head';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

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

export function SeoInfoPage({ path, title, description, eyebrow, sections }: SeoInfoPageProps) {
  const canonical = `${SITE_URL}${path}`;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="robots" content="index,follow" />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
      </Head>

      <View style={styles.header}>
        <Link href="/" style={styles.backLink}>Back to Game</Link>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.title}>{title.replace(' - Wordle Unlimited Party', '')}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>

      {sections.map(section => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.sectionBody}>{section.body}</Text>
          {section.items?.map(item => (
            <Text key={item} style={styles.listItem}>{`\u2022 ${item}`}</Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#071018' },
  content: { width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 22, paddingVertical: 30, gap: 18 },
  header: { borderBottomWidth: 1, borderBottomColor: '#1F2937', paddingBottom: 22, gap: 10 },
  backLink: { color: '#22C55E', fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  eyebrow: { color: '#94A3B8', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  title: { color: '#F8FAFC', fontSize: 34, lineHeight: 39, fontWeight: '900' },
  description: { color: '#CBD5E1', fontSize: 16, lineHeight: 24, fontWeight: '700' },
  section: { borderWidth: 1, borderColor: '#1F2937', backgroundColor: '#0B1220', borderRadius: 18, padding: 18, gap: 8 },
  sectionTitle: { color: '#22C55E', fontSize: 20, fontWeight: '900' },
  sectionBody: { color: '#D1D5DB', fontSize: 15, lineHeight: 23, fontWeight: '700' },
  listItem: { color: '#CBD5E1', fontSize: 14, lineHeight: 22, fontWeight: '700' },
});

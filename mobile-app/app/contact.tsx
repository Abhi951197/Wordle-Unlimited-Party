import { SeoInfoPage } from '@/components/SeoInfoPage';

export default function ContactPage() {
  return (
    <SeoInfoPage
      path="/contact"
      title="Contact - Wordle Unlimited Party"
      eyebrow="Contact"
      description="Contact the Wordle Unlimited Party project for feedback, bug reports, SEO questions, and multiplayer word game improvements."
      sections={[
        {
          title: 'Feedback',
          body: 'Share feedback about gameplay, multiplayer rooms, voice chat, hints, design, or mobile responsiveness so the app can improve.',
        },
        {
          title: 'Bug Reports',
          body: 'When reporting a bug, include the device, browser, room mode, and what happened before the issue appeared.',
        },
        {
          title: 'Search and Indexing',
          body: 'This page exists so search engines and users can find project contact information without needing to run the game UI first.',
        },
      ]}
    />
  );
}

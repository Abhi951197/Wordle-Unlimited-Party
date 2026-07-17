import { SeoInfoPage } from '@/components/SeoInfoPage';

export default function TermsPage() {
  return (
    <SeoInfoPage
      path="/terms"
      title="Terms of Use - Wordle Unlimited Party"
      eyebrow="Terms"
      description="Read the Wordle Unlimited Party terms of use for playing the online word game, party rooms, voice chat, and fair usage."
      sections={[
        {
          title: 'Use of the App',
          body: 'Wordle Unlimited Party is provided as an online word game for entertainment and learning. You may play solo or with friends in party rooms.',
        },
        {
          title: 'Player Conduct',
          body: 'Use respectful names, chat messages, and voice communication. Do not abuse rooms, spam, or disrupt other players.',
        },
        {
          title: 'Availability',
          body: 'The app may change, go offline, or reset in-memory rooms during maintenance, deployments, or hosting interruptions.',
        },
        {
          title: 'No Warranty',
          body: 'The game is provided as-is. Statistics, rooms, and voice sessions are best-effort features and may not always be available.',
        },
      ]}
    />
  );
}

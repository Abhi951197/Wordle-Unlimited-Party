import { SeoInfoPage } from '@/components/SeoInfoPage';

export default function FeaturesPage() {
  return (
    <SeoInfoPage
      path="/features"
      title="Features - Wordle Unlimited Party"
      eyebrow="Features"
      description="Explore Wordle Unlimited Party features including multiplayer rooms, voice chat, shared boards, hints, meanings, and difficulty levels."
      sections={[
        {
          title: 'Multiplayer Rooms',
          body: 'Create a room, share a code or invite link, and play Wordle online with friends from different devices.',
        },
        {
          title: 'Shared and Individual Boards',
          body: 'Use a shared board when everyone wants to solve together, or play individual boards while staying in the same party room.',
        },
        {
          title: 'Voice and Chat',
          body: 'Live voice chat and room text chat make the game feel social without requiring a separate call.',
        },
        {
          title: 'Learning Tools',
          body: 'Hints, answer meanings, statistics, and difficulty levels make the app useful for both casual players and word game fans.',
        },
      ]}
    />
  );
}

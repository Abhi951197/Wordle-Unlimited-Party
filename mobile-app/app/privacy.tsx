import { SeoInfoPage } from '@/components/SeoInfoPage';

export default function PrivacyPage() {
  return (
    <SeoInfoPage
      path="/privacy"
      title="Privacy Policy - Wordle Unlimited Party"
      eyebrow="Privacy"
      description="Read the Wordle Unlimited Party privacy policy for gameplay data, room information, analytics, voice chat, and local storage."
      sections={[
        {
          title: 'Information We Use',
          body: 'The app uses basic gameplay information such as guesses, room codes, player names, selected emoji, difficulty, and statistics to run the game.',
        },
        {
          title: 'Local Storage',
          body: 'Recent rooms, settings, and statistics may be stored on your device so the app can remember your preferences.',
        },
        {
          title: 'Analytics and Hosting',
          body: 'The website may use Vercel Analytics and hosting logs to understand visits, performance, and errors. These tools help improve the app.',
        },
        {
          title: 'Voice Chat',
          body: 'Voice chat is optional and powered by LiveKit. Microphone access is requested only when you choose to join voice.',
        },
      ]}
    />
  );
}

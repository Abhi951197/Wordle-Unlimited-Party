import { SeoInfoPage } from '@/components/SeoInfoPage';

export default function LeaderboardPage() {
  return (
    <SeoInfoPage
      path="/leaderboard"
      title="Leaderboard - Wordle Unlimited Party"
      eyebrow="Rankings"
      description="See how the Wordle Unlimited Party leaderboard works, including no-login usernames, rankings, scoring rules, and difficulty tabs."
      sections={[
        {
          title: 'No-Login Rankings',
          body: 'Players choose a unique public username once. The profile is stored on the device and used to rank completed games without requiring an account login.',
        },
        {
          title: 'Leaderboard Tabs',
          body: 'Rankings include Overall, Easy, Moderate, Difficult, and Prodigy views so players can compare fairly by difficulty.',
        },
        {
          title: 'Scoring Rules',
          body: 'Wins earn base points by difficulty, plus bonus points for fewer guesses and no hints. Hint-assisted wins still count, but hints reduce the score.',
          items: ['Easy win: 100 points', 'Moderate win: 140 points', 'Difficult win: 180 points', 'Prodigy win: 250 points', 'Efficiency bonus: 10 points per remaining guess'],
        },
      ]}
    />
  );
}

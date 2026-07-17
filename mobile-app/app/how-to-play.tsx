import { SeoInfoPage } from '@/components/SeoInfoPage';

export default function HowToPlayPage() {
  return (
    <SeoInfoPage
      path="/how-to-play"
      title="How to Play Wordle Unlimited Party"
      eyebrow="Guide"
      description="Learn how to play Wordle Unlimited Party, read color clues, use hints, and play solo or multiplayer word games online."
      sections={[
        {
          title: 'Basic Rules',
          body: 'Guess the hidden five-letter word before you run out of guesses. Every submitted word gives color feedback that helps narrow the answer.',
          items: ['Green means the letter is correct and in the right position.', 'Yellow means the letter is in the answer but in another position.', 'Dark means the letter is not in the answer.'],
        },
        {
          title: 'Solo Mode',
          body: 'Solo mode is a clean unlimited Wordle experience. Choose a difficulty, type guesses with your keyboard, and keep improving your streak.',
        },
        {
          title: 'Party Mode',
          body: 'Party mode lets friends join the same room, talk with optional voice chat, and play on shared or individual boards while staying connected.',
        },
        {
          title: 'Hints and Meanings',
          body: 'Hints are limited so the game still feels fair. After a puzzle ends, the app shows the answer meaning so you can learn new words.',
        },
      ]}
    />
  );
}

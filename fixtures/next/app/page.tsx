import { Counter } from './components/Counter';

export default function Page() {
  return (
    <main className="page">
      <header>
        <h1>Arbora fixture</h1>
        <p>Next.js App Router + React 19. Used by Arbora&apos;s end-to-end tests.</p>
      </header>
      <Counter />
    </main>
  );
}

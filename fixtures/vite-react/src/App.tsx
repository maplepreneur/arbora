import { useState } from 'react';
import { Card } from './components/Card';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6 md:p-12">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">Arbora fixture</h1>
        <p className="text-slate-600">Vite + React + Tailwind. Used by Arbora&apos;s end-to-end tests.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Counter"
          description={`Clicked ${count} times`}
          actionLabel="Increment"
          onAction={() => setCount((c) => c + 1)}
        />
        <Card
          title="Console"
          description="Logs an error so the Problems tab has something to show."
          actionLabel="Log error"
          onAction={() => console.error('fixture: intentional error')}
        />
        <Card
          title="Network"
          description="Requests a missing API route so the Problems tab shows a 404."
          actionLabel="Request missing API"
          onAction={() => void fetch('/api/missing.json', { headers: { accept: 'application/json' } })}
        />
      </div>
    </main>
  );
}

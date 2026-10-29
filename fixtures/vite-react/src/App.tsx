import { useState } from 'react';
import { Button } from './components/Button';
import { Card } from './components/Card';

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6 md:p-12">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">Arbora fixture</h1>
        <p className="text-slate-600">A small React app used by Arbora&apos;s end-to-end tests.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Counter">
          <p data-testid="count" className="text-slate-700">
            Clicked {count} {count === 1 ? 'time' : 'times'}
          </p>
          <Button
            onClick={() => {
              setCount((value) => value + 1);
            }}
          >
            Increment
          </Button>
        </Card>

        <Card title="Diagnostics">
          <p className="text-slate-700">Emit a console error for the Problems tab.</p>
          <Button
            variant="secondary"
            onClick={() => {
              console.error('Fixture error: button clicked');
            }}
          >
            Log an error
          </Button>
        </Card>
      </div>
    </main>
  );
}

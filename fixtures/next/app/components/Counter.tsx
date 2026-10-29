'use client';

import { useState } from 'react';
import { Card } from './Card';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div className="grid">
      <Card
        title="Counter"
        description={`Clicked ${count} times`}
        actionLabel="Increment"
        onAction={() => setCount((c) => c + 1)}
      />
    </div>
  );
}

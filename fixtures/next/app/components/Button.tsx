'use client';

import type { ReactNode } from 'react';

export function Button({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="fixture-button" onClick={onClick}>
      {children}
    </button>
  );
}

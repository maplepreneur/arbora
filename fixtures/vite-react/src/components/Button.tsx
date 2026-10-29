import type { ReactNode } from 'react';

export function Button({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700">
      {children}
    </button>
  );
}

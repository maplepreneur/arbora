import { Button } from './Button';

export interface CardProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

export function Card({ title, description, actionLabel, onAction }: CardProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm" data-testid={`card-${title.toLowerCase()}`}>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-slate-600">{description}</p>
      <div className="mt-4">
        <Button onClick={onAction}>{actionLabel}</Button>
      </div>
    </section>
  );
}

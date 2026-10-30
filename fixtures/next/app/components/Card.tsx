'use client';

import { Button } from './Button';

export interface CardProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

export function Card({ title, description, actionLabel, onAction }: CardProps) {
  return (
    <section className="card counter-card" data-testid={`card-${title.toLowerCase()}`}>
      <h2>{title}</h2>
      <p>{description}</p>
      <Button onClick={onAction}>{actionLabel}</Button>
    </section>
  );
}

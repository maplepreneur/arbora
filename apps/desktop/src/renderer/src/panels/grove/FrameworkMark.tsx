import type { ProjectFramework } from '@arbora/shared';

/** Small monochrome marks. Arbora reuses the tree from the shipped app icon. The others are simple shapes, not brand lockups. */
export function FrameworkMark({
  framework,
  className = 'h-4 w-4 shrink-0',
}: {
  framework: ProjectFramework;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden data-testid="framework-mark" data-framework={framework} className={className}>
      <FrameworkPath framework={framework} />
    </svg>
  );
}

function FrameworkPath({ framework }: { framework: ProjectFramework }) {
  switch (framework) {
    case 'next':
      return (
        <>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5.2 11.2V4.8l5.6 6.4V4.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </>
      );
    case 'nuxt':
      return <path fill="currentColor" d="M1.5 13.2 6.2 4.2 8.2 7.6 5.6 13.2zm6.2 0 2.6-4.6 2.6 4.6z" />;
    case 'vue':
      return <path fill="currentColor" d="M2 3.2h3.2L8 8.4 10.8 3.2H14L8 13.4z" />;
    case 'react':
      return (
        <>
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <ellipse cx="8" cy="8" rx="6.2" ry="2.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <ellipse
            cx="8"
            cy="8"
            rx="6.2"
            ry="2.3"
            transform="rotate(60 8 8)"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <ellipse
            cx="8"
            cy="8"
            rx="6.2"
            ry="2.3"
            transform="rotate(120 8 8)"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
        </>
      );
    case 'vite':
      return <path fill="currentColor" d="M9.2 1.2 3.4 9.2h3.2L5.6 14.8 12.8 6.4H9.4z" />;
    case 'rails':
      return <path fill="currentColor" d="M8 1.4 14.2 8 8 14.6 1.8 8z" />;
    case 'svelte':
      return <path fill="currentColor" d="M9.6 1.6 6.2 7.2h2.4L6 14.4l5.2-6.6H8.6z" />;
    case 'sveltekit':
      return <path fill="currentColor" d="M8 1.4 13.4 6.2 8 14.6 2.6 6.2z" />;
    case 'angular':
      return (
        <path
          fill="currentColor"
          d="M8 1.2 14.4 4.2 13 13.2 8 14.8 3 13.2 1.6 4.2zm0 3.2L5.2 11.6h1.4l.6-1.6h2.6l.6 1.6h1.4z"
        />
      );
    case 'remix':
      return <path fill="currentColor" d="M3 3h6.2v2.2H5.2V13H3zm4 0H13v10h-2.2V5.2H7z" />;
    case 'astro':
      return (
        <path fill="currentColor" d="M8 1.2 10.2 6.4 15 7.2 11.4 10.4 12.4 15 8 12.6 3.6 15 4.6 10.4 1 7.2 5.8 6.4z" />
      );
    case 'arbora':
      return (
        <>
          <path fill="currentColor" d="M8 1.4 13.4 8.6H10.8l1.8 2.6H3.4l1.8-2.6H2.6z" />
          <rect x="7.1" y="11.4" width="1.8" height="3" rx="0.3" fill="currentColor" />
        </>
      );
    default: {
      const unreachable: never = framework;
      return unreachable;
    }
  }
}

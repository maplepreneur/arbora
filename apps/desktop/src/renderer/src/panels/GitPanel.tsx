import { GitBranch } from 'lucide-react';
import { Placeholder } from '../components/Placeholder';

export default function GitPanel({ variant }: { variant: 'sidebar' | 'panel' }) {
  return <Placeholder icon={GitBranch} title={variant === 'sidebar' ? 'Source Control' : 'Git'} stage={8} />;
}

import { z } from 'zod';

export const platformSchema = z.enum(['darwin', 'linux', 'win32']);
export type Platform = z.infer<typeof platformSchema>;

export function toPlatform(nodePlatform: string): Platform {
  switch (nodePlatform) {
    case 'darwin':
    case 'win32':
      return nodePlatform;
    default:
      return 'linux';
  }
}

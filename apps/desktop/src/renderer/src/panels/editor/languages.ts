import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { vue } from '@codemirror/lang-vue';
import type { Extension } from '@codemirror/state';
import { svelte } from '@replit/codemirror-lang-svelte';
import { languageIdForPath, type LanguageId } from './language-id';

function extensionFor(id: LanguageId): Extension {
  switch (id) {
    case 'javascript':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'typescript':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'html':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    case 'markdown':
      return markdown();
    case 'python':
      return python();
    case 'go':
      return go();
    case 'rust':
      return rust();
    case 'vue':
      return vue();
    case 'svelte':
      return svelte();
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

/** Highlighting for `path`, or nothing for unknown types. Vue and Svelte are best-effort. */
export function languageFor(path: string): Extension {
  const id = languageIdForPath(path);
  return id ? extensionFor(id) : [];
}

import { ipcRenderer, webFrame, type IpcRendererEvent } from 'electron';
import {
  pageEvents,
  pageIpcName,
  type ComponentEntry,
  type FrameworkInfo,
  type InspectorSelection,
  type PageEvent,
  type PageEventName,
  type PageMessage,
  type PageMessageName,
} from '@arbora/shared';
import {
  CHAIN_LIMIT,
  describeElement,
  DesignOverlay,
  ElementRefs,
  Inspector,
  mainWorldCall,
  mainWorldInstallScript,
  stableSelector,
} from '@arbora/browser-bridge/page';

/**
 * Preload injected into the user's page inside the browser panel's `WebContentsView`. It runs in
 * Electron's isolated world and exposes nothing to the page (no `contextBridge`). It talks to main
 * over the private `arbora:page:` channel. Stage 4 adds the agent-mode inspector; Stage 6 adds the
 * design overlay.
 */

function send<K extends PageMessageName>(name: K, payload: PageMessage<K>): void {
  ipcRenderer.send(pageIpcName(name), payload);
}

function on<K extends PageEventName>(name: K, listener: (payload: PageEvent<K>) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, raw: unknown): void => {
    const parsed = pageEvents[name].safeParse(raw);
    // `name` selected the schema, which the generic signature cannot express.
    if (parsed.success) listener(parsed.data as PageEvent<K>);
  };
  ipcRenderer.on(pageIpcName(name), wrapped);
  return () => {
    ipcRenderer.off(pageIpcName(name), wrapped);
  };
}

on('ping', ({ nonce }) => send('pong', { nonce }));

// --- Agent mode inspector -----------------------------------------------------------------------

const NO_FRAMEWORK: FrameworkInfo = { id: 'html', react: false, vue: false, reactVersion: null };
let mainWorldReady: Promise<boolean> | null = null;

/**
 * Runs `code` in the page's main world, where React and Vue keep their expandos on DOM nodes
 * (the isolated world cannot see them). Installs the resolver once per document.
 */
async function inMainWorld<T>(code: string): Promise<T | null> {
  mainWorldReady ??= webFrame.executeJavaScript(mainWorldInstallScript()).then(
    () => true,
    () => {
      mainWorldReady = null;
      return false;
    },
  );
  if (!(await mainWorldReady)) return null;
  try {
    return (await webFrame.executeJavaScript(code)) as T | null;
  } catch {
    return null;
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

const refs = new ElementRefs();

async function reportSelection(element: Element, targetIndex: number): Promise<void> {
  const ref = refs.assign(element);
  const [framework, components] = await Promise.all([
    inMainWorld<FrameworkInfo>(mainWorldCall('detect')),
    inMainWorld<ComponentEntry[]>(mainWorldCall('forRef', ref, CHAIN_LIMIT)),
  ]);
  const chain = components ?? [];
  const notes: string[] = [];
  if (element.tagName === 'IFRAME') {
    notes.push('The selection is an iframe; Arbora cannot inspect inside it (cross-origin frames are opaque).');
  }
  const selection: InspectorSelection = {
    url: clip(location.href, 4000),
    title: clip(document.title, 500),
    ref,
    selector: clip(stableSelector(element), 2000),
    framework: framework ?? NO_FRAMEWORK,
    components: chain.map((c) => ({
      ...c,
      name: clip(c.name, 200),
      definedAt: c.definedAt && { ...c.definedAt, file: clip(c.definedAt.file, 2000) },
      renderedAt: c.renderedAt && { ...c.renderedAt, file: clip(c.renderedAt.file, 2000) },
    })),
    targetIndex: Math.min(targetIndex, Math.max(0, chain.length - 1)),
    element: describeElement(element, window),
    viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio },
    notes,
  };
  send('inspector.selected', selection);
}

const inspector = new Inspector(window, {
  chainAt: async (x, y) => (await inMainWorld<ComponentEntry[]>(mainWorldCall('atPoint', x, y, CHAIN_LIMIT))) ?? [],
  select: (element, targetIndex) => void reportSelection(element, targetIndex),
  cancel: () => send('inspector.cancelled', {}),
});

on('inspector.start', () => inspector.start());
on('inspector.stop', () => inspector.stop());
on('inspector.setOverlay', ({ visible, nonce }) => {
  inspector.setVisible(visible);
  requestAnimationFrame(() => requestAnimationFrame(() => send('inspector.overlayApplied', { nonce })));
});

// --- Design mode --------------------------------------------------------------------------------

const design = new DesignOverlay(window, {
  chainFor: async (element) => {
    const ref = refs.assign(element);
    const chain = (await inMainWorld<ComponentEntry[]>(mainWorldCall('forRef', ref, CHAIN_LIMIT))) ?? [];
    const host =
      (await inMainWorld<{ file: string; line: number | null } | null>(mainWorldCall('hostSource', ref))) ?? null;
    // The host fiber is the tag that was edited. The chain's render site is where the component is used.
    const source = host?.line ? host : (chain[0]?.renderedAt ?? chain[0]?.definedAt ?? null);
    return { names: chain.map((entry) => entry.name), file: source?.file ?? null, line: source?.line ?? null };
  },
  onState: (state) => send('design.state', state),
  onExitRequest: () => send('design.exitRequested', {}),
});

on('design.start', ({ ops, cursor }) => {
  void inMainWorld<FrameworkInfo>(mainWorldCall('detect')).then((framework) => {
    design.start({ ops, cursor }, framework ?? NO_FRAMEWORK);
  });
});
on('design.stop', ({ revert }) => design.stop(revert));
on('design.command', (command) => design.command(command));
on('design.setOverlay', ({ visible, nonce }) => {
  design.setVisible(visible);
  requestAnimationFrame(() => requestAnimationFrame(() => send('design.overlayApplied', { nonce })));
});

function reportReady(): void {
  send('ready', { url: location.href, title: document.title });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', reportReady, { once: true });
} else {
  reportReady();
}

// A filled password field that is submitted (or left by a navigation) offers a save. The values
// stay in the page; main reads them over CDP only after the user accepts.
let passwordTouched = false;
document.addEventListener(
  'input',
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'password' && target.value.length > 0) {
      passwordTouched = true;
    }
  },
  true,
);

function offerSave(form: HTMLFormElement): void {
  if (!passwordTouched) return;
  const password = form.querySelector('input[type="password"]');
  if (!(password instanceof HTMLInputElement)) return;
  const username = form.querySelector(
    'input[type="email"], input[autocomplete="username"], input[name="username" i], input[name="email" i], input[type="text"]',
  );
  send('passwords.offerSave', {
    origin: location.origin,
    usernameField: username instanceof HTMLInputElement ? username.name || username.id || null : null,
    passwordField: password.name || password.id || 'password',
  });
  passwordTouched = false;
}

document.addEventListener(
  'submit',
  (event) => {
    if (event.target instanceof HTMLFormElement) offerSave(event.target);
  },
  true,
);

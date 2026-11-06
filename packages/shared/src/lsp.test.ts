import { describe, expect, it } from 'vitest';
import {
  absoluteProjectPath,
  fileUriFromPath,
  languageIdForPath,
  pathFromFileUri,
  relativeProjectPath,
  sanitizeLspHtml,
} from './lsp.js';

describe('language server paths', () => {
  it('maps TypeScript and JavaScript extensions', () => {
    expect(languageIdForPath('/p/src/App.tsx')).toBe('typescriptreact');
    expect(languageIdForPath('C:\\p\\a.ts')).toBe('typescript');
    expect(languageIdForPath('/p/util.js')).toBe('javascript');
    expect(languageIdForPath('/p/readme')).toBeNull();
    expect(languageIdForPath('/p/.gitignore')).toBeNull();
  });

  it('joins a project-relative editor path and finds it again', () => {
    expect(absoluteProjectPath('/proj', 'src/App.tsx')).toBe('/proj/src/App.tsx');
    expect(relativeProjectPath('/proj', '/proj/src/App.tsx')).toBe('src/App.tsx');
    expect(absoluteProjectPath('C:\\proj', 'src/App.tsx')).toBe('C:\\proj\\src\\App.tsx');
    expect(relativeProjectPath('C:\\proj', 'C:\\proj\\src\\App.tsx')).toBe('src/App.tsx');
    expect(relativeProjectPath('/proj', '/other/App.tsx')).toBeNull();
  });

  it('round-trips file URIs, including spaces and a Windows drive', () => {
    const unix = '/home/me/My Project/App.tsx';
    expect(pathFromFileUri(fileUriFromPath(unix))).toBe(unix);
    const windows = 'C:\\repo\\src\\App.tsx';
    expect(fileUriFromPath(windows)).toBe('file:///C:/repo/src/App.tsx');
    expect(pathFromFileUri('file:///C:/repo/src/App.tsx')).toBe(windows);
    expect(pathFromFileUri('https://example.com')).toBeNull();
  });

  it('strips script and event handlers from server HTML', () => {
    const cleaned = sanitizeLspHtml('<p onclick="alert(1)">Hi</p><script>alert(1)</script>');
    expect(cleaned).not.toContain('script');
    expect(cleaned).not.toContain('onclick');
    expect(cleaned).toContain('Hi');
  });
});

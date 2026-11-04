import { describe, expect, it } from 'vitest';
import { detectProjectFramework } from './project-framework.js';

const json = (body: unknown): string => JSON.stringify(body);

describe('detectProjectFramework', () => {
  it('picks Next from a next package.json, ahead of React', () => {
    expect(
      detectProjectFramework({
        packageJson: json({ dependencies: { next: '14.2.5', react: '18.3.1', 'react-dom': '18.3.1' } }),
      }),
    ).toBe('next');
  });

  it('picks Nuxt from a nuxt package.json, ahead of Vue and Vite', () => {
    expect(
      detectProjectFramework({
        packageJson: json({ dependencies: { nuxt: '3.13.0', vue: '3.5.0' }, devDependencies: { vite: '5.4.0' } }),
      }),
    ).toBe('nuxt');
  });

  it('picks React from a plain react package.json', () => {
    expect(
      detectProjectFramework({ packageJson: json({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1' } }) }),
    ).toBe('react');
  });

  it('picks React when Vite is also a dependency', () => {
    expect(
      detectProjectFramework({
        packageJson: json({ dependencies: { react: '18.3.1' }, devDependencies: { vite: '5.4.0' } }),
      }),
    ).toBe('react');
  });

  it('picks Vue from a vue package.json that is not Nuxt', () => {
    expect(detectProjectFramework({ packageJson: json({ dependencies: { vue: '3.5.0' } }) })).toBe('vue');
  });

  it('picks Vite only when it is the app framework', () => {
    expect(detectProjectFramework({ packageJson: json({ devDependencies: { vite: '5.4.0' } }) })).toBe('vite');
  });

  it('picks Rails from a Gemfile', () => {
    expect(detectProjectFramework({ gemfile: 'source "https://rubygems.org"\ngem "rails", "~> 7.1"\n' })).toBe('rails');
  });

  it('picks Rails from config/application.rb', () => {
    expect(detectProjectFramework({ rails: true })).toBe('rails');
  });

  it('picks Arbora for an empty folder', () => {
    expect(detectProjectFramework({})).toBe('arbora');
  });
});

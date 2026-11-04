import { describe, expect, it } from 'vitest';
import { detectProjectCommands, packageManagerFor, terminalAgentName } from './project-commands.js';

describe('project commands', () => {
  it('reads package.json scripts with the lockfile package manager and skips pre/post hooks', () => {
    expect(packageManagerFor({ pnpm: true, yarn: true })).toBe('pnpm');
    const commands = detectProjectCommands({
      packageManager: 'pnpm',
      packageJson: JSON.stringify({ scripts: { dev: 'vite', pretest: 'tsc', test: 'vitest', posttest: 'echo' } }),
    });
    expect(commands.map((command) => [command.title, command.command])).toEqual([
      ['pnpm:dev', 'pnpm run dev'],
      ['pnpm:test', 'pnpm run test'],
    ]);
  });

  it('keeps preview and framework scripts, and titles them with the runner', () => {
    const commands = detectProjectCommands({
      packageManager: 'npm',
      packageJson: JSON.stringify({
        scripts: {
          dev: 'vite',
          preview: 'vite preview',
          format: 'prettier --write .',
          generate: 'nuxt generate',
          pretest: 'echo no',
        },
      }),
    });
    expect(commands.map((command) => command.title)).toEqual(['npm:dev', 'npm:preview', 'npm:generate']);
    const withProcfile = detectProjectCommands({
      packageManager: 'npm',
      packageJson: JSON.stringify({ scripts: { dev: 'vite' } }),
      procfileDev: 'web: npm run dev\n',
    });
    expect(withProcfile.map((command) => command.title)).toEqual(['npm:dev', 'web']);
  });

  it('offers the Rails commands, including jobs only when bin/jobs exists', () => {
    const commands = detectProjectCommands({ rails: true, binDev: true, binJobs: true });
    expect(commands.map((command) => command.command)).toEqual([
      'bin/dev',
      'bundle install',
      'bin/rails db:migrate',
      'bin/rails db:rollback',
      'bin/rails db:seed',
      'bin/rails routes',
      'bin/rails console',
      'bin/rails test',
      'bin/jobs',
    ]);
    expect(commands.map((command) => command.title)).toEqual([
      'Dev server',
      'Bundle install',
      'Migrate',
      'Rollback',
      'Seed',
      'Routes',
      'Console',
      'Test',
      'Jobs',
    ]);
  });

  it('runs RSpec instead of Minitest when the Gemfile has rspec and spec/ exists', () => {
    const gemfile = "source 'https://rubygems.org'\ngroup :test do\n  gem 'rspec-rails'\nend\n";
    const withSpec = detectProjectCommands({ rails: true, gemfile, specDir: true });
    expect(withSpec.find((command) => command.title === 'Test')?.command).toBe('bundle exec rspec');
    expect(withSpec.find((command) => command.title === 'Dev server')?.command).toBe('bin/rails server');
    const noSpecDir = detectProjectCommands({ rails: true, gemfile });
    expect(noSpecDir.find((command) => command.title === 'Test')?.command).toBe('bin/rails test');
  });

  it('reads a Procfile, a Makefile, Composer, Cargo and Go', () => {
    const commands = detectProjectCommands({
      procfileDev: 'web: npm run dev\n# skip\nworker: php artisan queue:work\n',
      makefile: '.PHONY: test\ntest:\n  go test\n',
      composerJson: JSON.stringify({ scripts: { lint: 'pint' } }),
      artisan: true,
      cargoToml: true,
      goMod: true,
    });
    expect(commands.map((command) => command.command)).toEqual([
      'npm run dev',
      'php artisan queue:work',
      'make test',
      'composer run lint',
      'php artisan serve',
      'php artisan migrate',
      'php artisan test',
      'cargo run',
      'cargo test',
      'go run .',
      'go test ./...',
    ]);
  });

  it('names an agent CLI in a command line and ignores the ACP adapter', () => {
    expect(terminalAgentName('/usr/bin/claude --resume')).toBe('Claude Code');
    expect(terminalAgentName('node /opt/claude-code-acp')).toBeNull();
    expect(terminalAgentName('opencode acp')).toBe('OpenCode');
  });
});

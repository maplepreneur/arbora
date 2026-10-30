import { useState } from 'react';

/** Controlled inputs, for the Stage 5 `browser_type` and `browser_select_option` tools. */
export function NameForm() {
  const [name, setName] = useState('');
  const [size, setSize] = useState('medium');
  return (
    <form className="flex flex-col gap-2" data-testid="form" onSubmit={(event) => event.preventDefault()}>
      <label className="flex flex-col gap-1 text-slate-700">
        Name
        <input
          className="rounded border border-slate-300 px-2 py-1"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-slate-700">
        Size
        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={size}
          onChange={(event) => setSize(event.target.value)}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
      <p className="text-slate-600" data-testid="form-echo">
        Hello, {name || 'nobody'} ({size})
      </p>
    </form>
  );
}

import { type FormEvent, useState } from "react";
import { useBook } from "../../app/vault";
import type { Contact } from "../../core/wallets";
import { Button, Field, inputClass, LinkButton, Panel } from "../../ui/kit";

export function AddressBook() {
  const [book, save] = useBook();
  const [editing, setEditing] = useState<Contact | null>(null);

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    await save(book.map((c) => (c.address === editing!.address ? { ...c, name: editing!.name.trim() } : c)));
    setEditing(null);
  };

  return (
    <Panel title="Address book" aside={`${book.length} saved`}>
      {book.length === 0 && (
        <p className="m-0 text-sm text-ink-3">Save an address on the send screen to pay it again by name.</p>
      )}
      <ul className="m-0 grid list-none gap-3 p-0">
        {book.map((c) =>
          editing?.address === c.address ? (
            <li key={c.address}>
              <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={`New name for ${c.name}`}>
                    {(props) => (
                      <input
                        {...props}
                        className={inputClass}
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        autoComplete="off"
                        autoFocus
                      />
                    )}
                  </Field>
                </div>
                <Button type="submit" variant="primary" disabled={!editing.name.trim()}>
                  Save
                </Button>
                <Button onClick={() => setEditing(null)}>Cancel</Button>
              </form>
            </li>
          ) : (
            <li key={c.address} className="grid gap-0.5 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="min-w-0 flex-1 font-medium break-words">{c.name}</span>
                <LinkButton aria-label={`Rename ${c.name}`} onClick={() => setEditing(c)}>
                  Rename
                </LinkButton>
                <LinkButton aria-label={`Delete ${c.name}`} onClick={() => save(book.filter((b) => b !== c))}>
                  Delete
                </LinkButton>
              </div>
              <span className="font-mono text-xs break-all text-ink-3">{c.address}</span>
            </li>
          ),
        )}
      </ul>
    </Panel>
  );
}

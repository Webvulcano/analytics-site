"use client";

import RichTextEditor from "./RichTextEditor";
import ImageEditor from "./ImageEditor";

// Right-hand panel: edits one field (or one item/sub-field of a list).
export default function EditPanel({
  item, // { kind: "field", field } | { kind: "slot", slot }
  target,
  draft,
  onChange,
  onSave,
  onCancel,
  onReset,
  onClose,
  dirty,
  saving,
  status,
  canReset,
  readOnly,
  localeNote,
  siteUrl,
  onRetryPublish,
  image, // saved image of a slot (or undefined → template image)
  locale,
}) {
  const footer = (
    <PanelFooter
      status={status}
      onRetryPublish={onRetryPublish}
      onReset={onReset}
      resetLabel={item.kind === "slot" ? "Eredeti kép visszaállítása" : "Eredeti szöveg visszaállítása"}
      canReset={canReset}
      onCancel={onCancel}
      onSave={onSave}
      dirty={dirty}
      saving={saving}
      readOnly={readOnly}
    />
  );

  if (item.kind === "slot") {
    return (
      <PanelShell title={item.slot.label} section={item.slot.section_label} onClose={onClose} footer={footer}>
        <div className="space-y-4 p-4">
          {localeNote && <p className="text-xs text-zinc-500">{localeNote}</p>}
          {readOnly && <ReadOnlyNote />}
          <ImageEditor
            slot={item.slot}
            image={image}
            draft={draft}
            onChange={onChange}
            disabled={readOnly || saving}
            siteUrl={siteUrl}
            locale={locale}
          />
        </div>
      </PanelShell>
    );
  }

  const { field } = item;
  const opts = field.options ?? {};
  const isList = field.type === "list";
  const itemFields = opts.itemFields ?? [];

  // Which inputs to show: a single scalar, one list item sub-field, or a whole list.
  let body;
  if (!isList) {
    body = (
      <Control
        id={`f-${field.key}`}
        def={{ type: field.type, maxLength: opts.maxLength, lines: opts.lines }}
        label={field.label}
        help={field.help}
        value={draft}
        disabled={readOnly}
        onChange={(v) => onChange(v)}
      />
    );
  } else {
    const indexes = target.i != null ? [target.i] : draft.map((_, i) => i);
    body = indexes.map((i) => {
      const defs = target.i != null && target.f ? itemFields.filter((d) => d.key === target.f) : itemFields;
      return (
        <fieldset key={i} className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-xs font-medium text-zinc-500">{i + 1}. elem</legend>
          {defs.map((def) => (
            <Control
              key={def.key}
              id={`f-${field.key}-${i}-${def.key}`}
              def={def}
              label={def.label}
              value={draft[i]?.[def.key] ?? ""}
              disabled={readOnly}
              onChange={(v) => onChange(v, { i, f: def.key })}
            />
          ))}
        </fieldset>
      );
    });
  }

  return (
    <PanelShell
      title={isList && target.i != null ? `${field.label} — ${target.i + 1}. elem` : field.label}
      section={field.section_label}
      onClose={onClose}
      footer={footer}
    >
      <div className="space-y-4 p-4">
        {localeNote && <p className="text-xs text-zinc-500">{localeNote}</p>}
        {readOnly && <ReadOnlyNote />}
        {body}
      </div>
    </PanelShell>
  );
}

function ReadOnlyNote() {
  return (
    <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      Ez a weboldal jelenleg csak olvasható.
    </p>
  );
}

function PanelFooter({ status, onRetryPublish, onReset, resetLabel, canReset, onCancel, onSave, dirty, saving, readOnly }) {
  return (
    <div className="space-y-2">
      {status && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-xs ${
            status.type === "ok"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : status.type === "warn"
                ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {status.text}
          {status.retry && (
            <button type="button" onClick={onRetryPublish} className="ml-2 font-semibold underline">
              Újrapróbálás
            </button>
          )}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={!canReset || saving || readOnly}
          className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:invisible"
        >
          {resetLabel}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={!dirty || saving}
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Mégse
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving || readOnly}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {saving ? "Mentés…" : "Mentés"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelShell({ title, section, onClose, children, footer }) {
  return (
    <aside className="flex max-h-[70dvh] w-full flex-col border-t border-zinc-200 bg-white md:max-h-none md:w-96 md:shrink-0 md:border-l md:border-t-0 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">{section}</p>
          <h2 className="truncate font-semibold">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Panel bezárása"
          className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">{footer}</div>}
    </aside>
  );
}

function Control({ id, def, label, help, value, onChange, disabled }) {
  const max = def.maxLength;
  const length = typeof value === "string" ? value.length : 0;
  const over = max && length > max;
  const input =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {def.type === "richtext" ? (
        <RichTextEditor id={id} value={value} onChange={onChange} disabled={disabled} />
      ) : def.type === "textarea" ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={def.lines ? Math.min(12, Math.max(4, value.split("\n").length + 1)) : 4}
          className={`${input} resize-y`}
        />
      ) : (
        <input
          id={id}
          type={def.type === "url" ? "url" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={input}
        />
      )}
      <div className="mt-1 flex justify-between gap-2 text-xs text-zinc-500">
        <span>{def.lines ? "Soronként egy elem." : help}</span>
        {max && <span className={over ? "font-semibold text-red-600" : ""}>{length}/{max}</span>}
      </div>
    </div>
  );
}

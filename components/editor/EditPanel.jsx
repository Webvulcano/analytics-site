"use client";

import { useState } from "react";
import RichTextEditor from "./RichTextEditor";
import SortableList from "./SortableList";
import ImageEditor from "./ImageEditor";
import ResizableAside from "./ResizableAside";

// Right-hand panel: edits one field (or one item/sub-field of a list).
export default function EditPanel({
  item, // { kind: "field", field } | { kind: "slot", slot }
  target,
  draft,
  onChange,
  onReorder, // (from, to) → moves a list item (whole-list view only)
  onSave,
  onCancel,
  onReset,
  onClose,
  dirty,
  saving,
  status,
  canReset,
  readOnly,
  lockedMessage, // set → panel content is covered by a "disabled" overlay
  localeNote,
  siteUrl,
  onRetryPublish,
  image, // saved image of a slot (or undefined → template image)
  locale,
  panelWidth,
  onPanelResize,
  onPanelResizeEnd,
}) {
  const resize = { width: panelWidth, onResize: onPanelResize, onResizeEnd: onPanelResizeEnd };
  const shell = { onClose, resize, lockedMessage };
  const footer = (
    <PanelFooter
      status={status}
      onRetryPublish={onRetryPublish}
      onReset={onReset}
      resetLabel="Eredeti szöveg visszaállítása"
      canReset={item.kind === "slot" ? false : canReset} // images: the button sits under the picture
      onCancel={onCancel}
      onSave={onSave}
      dirty={dirty}
      saving={saving}
      readOnly={readOnly}
    />
  );

  if (item.kind === "slot") {
    return (
      <PanelShell title={item.slot.label} section={item.slot.section_label} footer={footer} {...shell}>
        <div className="space-y-4 p-4">
          {localeNote && <p className="text-xs text-zinc-500">{localeNote}</p>}
          {readOnly && !lockedMessage && <ReadOnlyNote />}
          <ImageEditor
            slot={item.slot}
            image={image}
            draft={draft}
            onChange={onChange}
            onReset={onReset}
            disabled={readOnly || saving}
            siteUrl={siteUrl}
            locale={locale}
          />
        </div>
      </PanelShell>
    );
  }

  return <FieldPanel {...{ item, target, draft, onChange, onReorder, readOnly, localeNote, lockedMessage, footer, shell }} />;
}

function FieldPanel({ item, target, draft, onChange, onReorder, readOnly, localeNote, lockedMessage, footer, shell }) {
  const { field } = item;
  const opts = field.options ?? {};
  const isList = field.type === "list";
  // hidden item fields (e.g. an icon id) travel with the item but are not edited here
  const itemFields = (opts.itemFields ?? []).filter((d) => !d.hidden);
  // Stable row ids for drag-to-reorder (the panel remounts on cancel/reset, which resets them).
  const [rowIds, setRowIds] = useState(() => (Array.isArray(draft) ? draft.map((_, i) => i) : []));

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
    const renderItem = (i, handle = null) => {
      const defs = target.i != null && target.f ? itemFields.filter((d) => d.key === target.f) : itemFields;
      return (
        <fieldset className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="flex items-center gap-1 px-1 text-xs font-medium text-zinc-500">
            {handle}
            {i + 1}. elem
          </legend>
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
    };
    if (target.i != null) {
      body = renderItem(target.i);
    } else {
      body = (
        <>
          {!readOnly && draft.length > 1 && (
            <p className="text-xs text-zinc-500">A ⠿ jellel húzva átrendezheted az elemeket. Mentés után a weboldalon is így jelennek meg.</p>
          )}
          <SortableList
            id={`sort-${field.key}`}
            ids={rowIds}
            disabled={readOnly || draft.length < 2}
            onMove={(from, to) => {
              setRowIds((ids) => move(ids, from, to));
              onReorder(from, to);
            }}
            renderItem={renderItem}
          />
        </>
      );
    }
  }

  return (
    <PanelShell
      title={isList && target.i != null ? `${field.label} — ${target.i + 1}. elem` : field.label}
      section={field.section_label}
      footer={footer}
      {...shell}
    >
      <div className="space-y-4 p-4">
        {localeNote && <p className="text-xs text-zinc-500">{localeNote}</p>}
        {readOnly && !lockedMessage && <ReadOnlyNote />}
        {body}
      </div>
    </PanelShell>
  );
}

function move(list, from, to) {
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
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

export function PanelShell({ title, section, onClose, children, footer, resize, lockedMessage }) {
  return (
    <ResizableAside
      {...resize}
      className="flex max-h-[70dvh] flex-col border-t border-zinc-200 bg-white md:max-h-none md:border-l md:border-t-0 dark:border-zinc-800 dark:bg-zinc-900"
    >
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
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto" inert={lockedMessage ? true : undefined}>{children}</div>
        {footer && (
          <div className="border-t border-zinc-200 p-4 dark:border-zinc-800" inert={lockedMessage ? true : undefined}>
            {footer}
          </div>
        )}
        {lockedMessage && (
          // Covers content + footer; the header (close button) stays usable.
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/75 p-6 backdrop-blur-[2px] dark:bg-zinc-900/75">
            <div
              role="status"
              className="flex max-w-xs items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 shadow-sm dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sky-500">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
                  clipRule="evenodd"
                />
              </svg>
              <p>{lockedMessage}</p>
            </div>
          </div>
        )}
      </div>
    </ResizableAside>
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

"use client";
import { useEffect, type RefObject } from "react";

const PREFIX = "m8-workspace-draft:";
const TTL = 60 * 60 * 1000;

// Per-tab, short-lived drafts. Keys include the authenticated account and
// project; acknowledgment checkboxes are never saved or restored.
export function useFormDraft(
  ref: RefObject<HTMLFormElement | null>,
  accountId: string,
  formId: string,
) {
  const key = `${PREFIX}${accountId}:${formId}`;
  function capture() {
    const form = ref.current;
    if (!form) return;
    const fields: Record<string, string> = {};
    for (const field of Array.from(form.elements)) {
      if (
        (field instanceof HTMLInputElement &&
          !["checkbox", "password"].includes(field.type)) ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
      ) {
        if (field.name) fields[field.name] = field.value;
      }
    }
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ expires: Date.now() + TTL, fields }),
      );
    } catch {
      /* Storage is optional; the mounted form still retains input. */
    }
  }
  function clear() {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Optional storage. */
    }
  }
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        expires?: number;
        fields?: Record<string, unknown>;
      };
      if (!draft.expires || draft.expires <= Date.now()) {
        sessionStorage.removeItem(key);
        return;
      }
      for (const [name, value] of Object.entries(draft.fields ?? {})) {
        const field = form.elements.namedItem(name);
        if (
          typeof value === "string" &&
          ((field instanceof HTMLInputElement &&
            !["checkbox", "password"].includes(field.type)) ||
            field instanceof HTMLTextAreaElement ||
            field instanceof HTMLSelectElement)
        )
          field.value = value;
      }
    } catch {
      /* Invalid or unavailable drafts are ignored. */
    }
  }, [key, ref]);
  return { capture, clear };
}

export function clearAccountDrafts(accountId: string) {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(`${PREFIX}${accountId}:`))
        sessionStorage.removeItem(key);
    }
  } catch {
    /* Optional storage. */
  }
}

"use client";
import { useCallback, useEffect, type RefObject } from "react";

const PREFIX = "m8-workspace-draft:";
const TTL = 60 * 60 * 1000;
const CONNECT_RETURN = "m8-new-project-return:";
const PROJECT_CONNECT_RETURN = "m8-project-connect-return:";
const START_RETURN = "m8-start-after-signin";

export function markStartProjectIntent() {
  try { sessionStorage.setItem(START_RETURN, String(Date.now() + TTL)); } catch { /* Optional storage. */ }
}

export function consumeStartProjectIntent() {
  try {
    const expires = Number(sessionStorage.getItem(START_RETURN));
    sessionStorage.removeItem(START_RETURN);
    return expires > Date.now();
  } catch { return false; }
}

export function markNewProjectReturn(accountId: string) {
  try {
    sessionStorage.setItem(`${CONNECT_RETURN}${accountId}`, String(Date.now() + TTL));
  } catch { /* Optional storage. */ }
}

export function consumeNewProjectReturn(accountId: string) {
  try {
    const key = `${CONNECT_RETURN}${accountId}`;
    const expires = Number(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    return expires > Date.now();
  } catch { return false; }
}

export function markProjectConnectReturn(accountId: string, projectId: string) {
  try { sessionStorage.setItem(`${PROJECT_CONNECT_RETURN}${accountId}`, JSON.stringify({ projectId, expires: Date.now() + TTL })); } catch { /* Optional storage. */ }
}
export function consumeProjectConnectReturn(accountId: string): string | null {
  try {
    const key = `${PROJECT_CONNECT_RETURN}${accountId}`, raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const value = raw ? JSON.parse(raw) as { projectId: string; expires: number } : null;
    return value && value.expires > Date.now() ? value.projectId : null;
  } catch { return null; }
}

// Per-tab, short-lived drafts. Keys include the authenticated account and
// project; acknowledgment checkboxes are never saved or restored.
export function useFormDraft(
  ref: RefObject<HTMLFormElement | null>,
  accountId: string,
  formId: string,
  restoreVersion: unknown = null,
) {
  const key = `${PREFIX}${accountId}:${formId}`;
  const capture = useCallback(() => {
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
  }, [key, ref]);
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Optional storage. */
    }
  }, [key]);
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
  }, [key, ref, restoreVersion]);
  return { capture, clear };
}

export function clearAccountDrafts(accountId: string) {
  try {
    sessionStorage.removeItem(`${CONNECT_RETURN}${accountId}`);
    sessionStorage.removeItem(`${PROJECT_CONNECT_RETURN}${accountId}`);
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(`${PREFIX}${accountId}:`))
        sessionStorage.removeItem(key);
    }
  } catch {
    /* Optional storage. */
  }
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RESTORE_FIELD } from "./field-events";

export function useFieldValue(defaultValue: string, value?: string, onValueChange?: (value: string) => void, normalize?: (value: string) => string) {
  const [localValue, setLocalValue] = useState(defaultValue);
  const fieldRef = useRef<HTMLInputElement>(null);
  const current = value ?? localValue;
  const [error, setError] = useState(false);
  const change = useCallback((raw: string, notify = true) => {
    const next = normalize ? normalize(raw) : raw;
    if (value === undefined) setLocalValue(next);
    setError(false);
    if (fieldRef.current) fieldRef.current.value = next;
    if (notify) {
      onValueChange?.(next);
      // FormData and the existing draft listener see the value synchronously.
      fieldRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, [value, onValueChange, normalize]);
  useEffect(() => {
    if (fieldRef.current) fieldRef.current.value = current;
  }, [current]);
  useEffect(() => {
    const field = fieldRef.current, form = field?.form;
    if (!field) return;
    const restore = (event: Event) => change((event as CustomEvent<string>).detail, false);
    const reset = () => change(defaultValue, false);
    field.addEventListener(RESTORE_FIELD, restore);
    form?.addEventListener("reset", reset);
    return () => {
      field.removeEventListener(RESTORE_FIELD, restore);
      form?.removeEventListener("reset", reset);
    };
  }, [change, defaultValue]);
  return { current, fieldRef, change, error, setError };
}

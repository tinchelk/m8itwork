"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import * as Select from "@radix-ui/react-select";
import { useFieldValue } from "./field-value";

export interface SelectChoice {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
}

// Shared with the account-scoped draft hook. Restoration is distinct from a
// user change: it updates the visible control without recapturing the draft.
function Chevron({ up = false }: { up?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={up ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>;
}
function RepositoryIcon() {
  return <svg className="field-leading-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 5a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1-2-2V5Zm0 13a2 2 0 0 1 2-2h12M9 7h6M9 10h4" /></svg>;
}

export function SelectField({
  options, value, defaultValue, onValueChange, name, id, placeholder = "Choose an option", disabled = false,
  required = false, repository = false, "aria-label": ariaLabel, "aria-describedby": describedBy,
}: {
  options: SelectChoice[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  repository?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const initial = defaultValue ?? options[0]?.value ?? "";
  const normalize = useCallback((next: string) => options.some(option => option.value === next && !option.disabled) ? next : "", [options]);
  const { current, fieldRef, change, error, setError } = useFieldValue(initial, value, onValueChange, normalize);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === current);
  const selectedValue = selected?.value ?? "";
  useEffect(() => {
    if (fieldRef.current) fieldRef.current.value = selectedValue;
  }, [current, selectedValue, fieldRef]);
  const errorId = `${controlId}-error`;
  const descriptions = [describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return <div className="select-field">
    <Select.Root value={selectedValue} onValueChange={next => {
      // Radix's unnamed form bridge can report an empty value on mount/reset.
      // Empty choices are placeholders; explicit clearing uses RESTORE_FIELD.
      if (next) change(next);
    }} disabled={disabled}>
      <Select.Trigger ref={triggerRef} id={controlId} className="field-trigger" aria-label={ariaLabel} aria-required={required || undefined} aria-invalid={error || undefined} aria-describedby={descriptions} data-value={selectedValue}>
        {repository ? <RepositoryIcon /> : null}
        <Select.Value placeholder={placeholder}><span className="field-value">{selected?.label}</span></Select.Value>
        {selected?.detail ? <span className="field-badge">{selected.detail}</span> : null}
        <Select.Icon className="field-chevron"><Chevron /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="field-menu" position="popper" sideOffset={7} collisionPadding={12}>
          <Select.ScrollUpButton className="field-scroll"><Chevron up /></Select.ScrollUpButton>
          <Select.Viewport className="field-options">
            {options.filter(option => option.value !== "").map(option => <Select.Item key={option.value} value={option.value} className="field-option" disabled={option.disabled} textValue={option.label} data-value={option.value}>
              {repository ? <RepositoryIcon /> : null}
              <Select.ItemText>{option.label}{option.detail ? <span className="field-visually-hidden"> {option.detail}</span> : null}</Select.ItemText>
              {option.detail ? <span className="field-badge">{option.detail}</span> : null}
              <Select.ItemIndicator className="field-check"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg></Select.ItemIndicator>
            </Select.Item>)}
          </Select.Viewport>
          <Select.ScrollDownButton className="field-scroll"><Chevron /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
    {name ? <input ref={fieldRef} className="field-form-value" data-ui-field="true" aria-hidden="true" tabIndex={-1} autoComplete="off" name={name} defaultValue={selectedValue} required={required} disabled={disabled} onInvalid={event => {
      event.preventDefault();
      setError(true);
      triggerRef.current?.focus();
    }} /> : null}
    {error ? <span id={errorId} className="field-error" role="alert">Choose an option to continue.</span> : null}
  </div>;
}

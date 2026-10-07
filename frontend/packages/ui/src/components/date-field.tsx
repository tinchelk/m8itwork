"use client";
import { useEffect, useId, useState, type InputHTMLAttributes } from "react";
import * as Popover from "@radix-ui/react-popover";
import dynamic from "next/dynamic";
import { useFieldValue } from "./field-value";

const DateCalendar = dynamic(() => import("./date-calendar").then(module => module.DateCalendar), {
  ssr: false,
  loading: () => <p className="field-hint" role="status">Loading calendar…</p>,
});

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day ? date : undefined;
}
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DateField({ name, min, required, disabled, id, defaultValue = "", "aria-label": ariaLabel }: Pick<InputHTMLAttributes<HTMLInputElement>, "name" | "required" | "disabled" | "id" | "aria-label"> & { min?: string; defaultValue?: string }) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const { current, fieldRef, change, error, setError } = useFieldValue(defaultValue);
  const [open, setOpen] = useState(false);
  const selected = parseDate(current), minimum = min ? parseDate(min) : undefined;
  const [month, setMonth] = useState(selected ?? minimum ?? new Date());
  const message = current && !selected ? "Enter a valid date as YYYY-MM-DD." : selected && min && current < min ? "Choose today or a later date." : "Choose a delivery date.";
  useEffect(() => {
    fieldRef.current?.setCustomValidity(current && (!selected || Boolean(min && current < min)) ? message : "");
  }, [current, min, selected, message, fieldRef]);
  return <div className="date-field">
    <Popover.Root open={open} onOpenChange={next => {
      if (next) setMonth(selected ?? minimum ?? new Date());
      setOpen(next);
    }}>
      <div className="date-field-control">
        <input ref={fieldRef} id={controlId} type="text" name={name} defaultValue={defaultValue} data-ui-field="true" autoComplete="off" placeholder="YYYY-MM-DD" maxLength={10} required={required} disabled={disabled} aria-label={ariaLabel} aria-invalid={error || undefined} aria-describedby={error ? `${controlId}-error` : `${controlId}-hint`} onChange={event => change(event.currentTarget.value)} onInvalid={event => { event.preventDefault(); setError(true); fieldRef.current?.focus(); }} />
        <Popover.Trigger className="field-calendar-trigger" disabled={disabled} aria-label="Open delivery date calendar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg></Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content className="field-calendar" align="start" sideOffset={7} collisionPadding={12} aria-label="Delivery date calendar" onCloseAutoFocus={event => { event.preventDefault(); fieldRef.current?.focus(); }}>
          <DateCalendar selected={selected} month={month} minimum={minimum} onMonthChange={setMonth} onSelect={date => { change(isoDate(date)); setOpen(false); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {error ? <span id={`${controlId}-error`} className="field-error" role="alert">{message}</span> : <span id={`${controlId}-hint`} className="field-hint">Year-month-day, or choose from the calendar.</span>}
  </div>;
}

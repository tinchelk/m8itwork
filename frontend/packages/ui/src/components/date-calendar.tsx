"use client";
import { DayPicker } from "react-day-picker";

export function DateCalendar({ selected, month, minimum, onMonthChange, onSelect }: {
  selected?: Date;
  month: Date;
  minimum?: Date;
  onMonthChange: (date: Date) => void;
  onSelect: (date: Date) => void;
}) {
  return <DayPicker mode="single" selected={selected} month={month} startMonth={minimum} onMonthChange={onMonthChange} disabled={minimum ? { before: minimum } : undefined} onSelect={date => { if (date) onSelect(date); }} autoFocus showOutsideDays fixedWeeks />;
}

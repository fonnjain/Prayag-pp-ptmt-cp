import { useEffect, useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/utils";

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

function toIsoDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function DateInput({ value, onChange, onBlur, min, max, placeholder = "dd-mm-yyyy", ...props }: DateInputProps) {
  const [text, setText] = useState(() => fmtDate(value));
  const isInRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  useEffect(() => {
    setText(fmtDate(value));
  }, [value]);

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (!next.trim()) onChange("");
        else {
          const iso = toIsoDate(next);
          if (iso && isInRange(iso)) onChange(iso);
        }
      }}
      onBlur={(event) => {
        const iso = toIsoDate(text);
        if (text.trim() && (!iso || !isInRange(iso))) setText(fmtDate(value));
        onBlur?.(event);
      }}
    />
  );
}
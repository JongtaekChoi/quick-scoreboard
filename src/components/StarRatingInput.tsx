"use client";

import { useMemo, useState } from "react";

type Props = {
  name: string;
  defaultValue?: number;
  initialValue?: number;
  submitLabel?: string;
};

const steps = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export default function StarRatingInput({
  name,
  defaultValue = 3,
  initialValue,
  submitLabel = "저장",
}: Props) {
  const start = initialValue ?? defaultValue;
  const [value, setValue] = useState<number>(start);
  const changed = Number(value.toFixed(1)) !== Number(start.toFixed(1));

  const label = useMemo(() => `${value.toFixed(1)}점`, [value]);

  return (
    <div className="flex items-center gap-2">
      <input type="hidden" name={name} value={value.toFixed(1)} />
      <div className="flex items-center gap-0.5">
        {steps.map((n) => {
          const active = n <= value;
          return (
            <button
              key={n}
              type="button"
              className={`text-sm leading-none ${active ? "text-amber-500" : "text-gray-300"}`}
              onClick={() => setValue(n)}
              aria-label={`${n.toFixed(1)}점`}
              title={`${n.toFixed(1)}점`}
            >
              ★
            </button>
          );
        })}
      </div>
      <span className="text-[11px] text-gray-600 min-w-10">{label}</span>
      <button className="rounded border px-2 py-1 text-xs disabled:text-gray-300" type="submit" disabled={!changed}>
        {submitLabel}
      </button>
    </div>
  );
}

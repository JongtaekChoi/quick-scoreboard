"use client";

import { useMemo, useState } from "react";

type Props = {
  name: string;
  defaultValue?: number;
};

const steps = [
  0.5, 1, 1.5, 2, 2.5,
  3, 3.5, 4, 4.5, 5,
];

export default function StarRatingInput({ name, defaultValue = 5 }: Props) {
  const [value, setValue] = useState<number>(defaultValue);

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
    </div>
  );
}

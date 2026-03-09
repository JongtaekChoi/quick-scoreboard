"use client";

import { useState } from "react";

type Props = {
  name: string;
  defaultValue?: number;
};

export default function StarRatingInput({ name, defaultValue = 5 }: Props) {
  const [value, setValue] = useState<number>(defaultValue);
  const [hover, setHover] = useState<number>(0);

  const active = hover || value;

  return (
    <div className="flex items-center gap-1">
      <input type="hidden" name={name} value={value} />
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`text-lg leading-none ${n <= active ? "text-amber-500" : "text-gray-300"}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => setValue(n)}
          aria-label={`${n}점`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

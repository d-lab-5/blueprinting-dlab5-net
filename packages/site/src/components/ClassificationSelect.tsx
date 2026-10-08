import * as React from "react";
import type { Classification } from "../lib/data";

/** The three classifications, worded once for every place that asks. */
export function ClassificationSelect({
  value,
  onChange,
}: {
  value: Classification;
  onChange: (value: Classification) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Classification)}>
      <option value="confidential">Confidential — never leaves this system</option>
      <option value="collaboration">
        Collaboration — travels with the product, never to a public repo
      </option>
      <option value="shared">Shared — safe anywhere, including a public repo</option>
    </select>
  );
}

import { useState } from "react";

export function useMonth() {
  const [month, setMonth] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    return `${year}-${m}`;
  });

  return { month, setMonth };
}

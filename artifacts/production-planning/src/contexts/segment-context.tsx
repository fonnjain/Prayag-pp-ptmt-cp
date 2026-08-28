import { createContext, useContext, useState, type ReactNode } from "react";

export type Segment = "PTMT" | "Plumbing";

interface SegmentContextValue {
  segment: Segment;
  setSegment: (s: Segment) => void;
}

const SegmentContext = createContext<SegmentContextValue>({
  segment: "PTMT",
  setSegment: () => {},
});

export function SegmentProvider({ children }: { children: ReactNode }) {
  const [segment, setSegmentState] = useState<Segment>(() => {
    const stored = window.localStorage.getItem("prayag-planning-segment");
    return stored === "Plumbing" ? "Plumbing" : "PTMT";
  });
  const setSegment = (next: Segment) => {
    window.localStorage.setItem("prayag-planning-segment", next);
    setSegmentState(next);
  };
  return (
    <SegmentContext.Provider value={{ segment, setSegment }}>
      {children}
    </SegmentContext.Provider>
  );
}

export function useSegment(): SegmentContextValue {
  return useContext(SegmentContext);
}

export default function Slide29() {
  return (
    <div className="w-screen h-screen overflow-hidden relative slide-shell ambient">
      <div className="absolute right-[7vw] top-[5vh] vertical-label kicker">27 / Audit</div>
      <div className="kicker">Engineering audit / machine contract</div>
      <h1 className="slide-title mt-[2.5vh] max-w-[78vw]">The Plumbing scheduler path is real, direct, and explicit</h1>
      <div className="mt-[5vh] grid grid-cols-[.85fr_1.15fr] gap-[2.5vw]">
        <div className="card-warm p-[2vw]">
          <div className="text-[1.2vw] uppercase tracking-[.14em] text-[#e7b24c]">Direct probe</div>
          <div className="mt-[2vh] metric text-[#e7b24c]">200</div>
          <div className="mt-[1.4vh] text-[1.6vw] leading-[1.12]">One known Plumbing code reached the plant scheduler for September 2026.</div>
          <div className="mt-[2.4vh] text-[1.35vw] text-[#a6b4b5]">No plan route, recompute, or persisted result was used for the probe.</div>
        </div>
        <div className="space-y-[1.4vh]">
          <div className="card p-[1.4vw]"><span className="text-[#89c9c0]">Contract:</span><span className="ml-[.7vw] text-[1.5vw]">PLUMBING + month + kind + week_days + demand</span></div>
          <div className="card p-[1.4vw]"><span className="text-[#89c9c0]">Persistence:</span><span className="ml-[.7vw] text-[1.5vw]">August run 44 has 7 batches and 14 persisted result rows</span></div>
          <div className="card p-[1.4vw]"><span className="text-[#89c9c0]">Failure mode:</span><span className="ml-[.7vw] text-[1.5vw]">502 named scheduler failure; no silent local fallback</span></div>
          <div className="card-soft p-[1.4vw]"><span className="text-[#d88366]">Open boundary:</span><span className="ml-[.7vw] text-[1.5vw]">September remains gated by the reviewed stock fingerprint and operating baseline</span></div>
        </div>
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] right-[7vw] text-[1.4vw] text-[#a6b4b5]">The important distinction: local capacity data supports interpretation; it does not pretend to be the plant scheduler.</div>
    </div>
  );
}
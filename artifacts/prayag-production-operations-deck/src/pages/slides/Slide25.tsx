export default function Slide25() {
  return (
    <div className="w-screen h-screen overflow-hidden relative slide-shell ambient">
      <div className="absolute right-[7vw] top-[5vh] vertical-label kicker">23 / Semantics</div>
      <div className="kicker">Plan row contract</div>
      <h1 className="slide-title mt-[2.5vh] max-w-[72vw]">Every plan row answers a different question</h1>
      <div className="mt-[5vh] grid grid-cols-2 gap-[1.6vw]">
        <div className="card p-[1.7vw]">
          <div className="flex items-baseline justify-between"><div className="display text-[2.4vw]">demandPlan</div><div className="text-[1.2vw] uppercase tracking-[.12em] text-[#89c9c0]">Owed</div></div>
          <div className="mt-[1.5vh] text-[1.6vw] leading-[1.15] text-[#d8dfda]">The quantity the business still owes for the selected month.</div>
        </div>
        <div className="card-warm p-[1.7vw]">
          <div className="flex items-baseline justify-between"><div className="display text-[2.4vw]">productionPlan</div><div className="text-[1.2vw] uppercase tracking-[.12em] text-[#e7b24c]">Executable</div></div>
          <div className="mt-[1.5vh] text-[1.6vw] leading-[1.15] text-[#d8dfda]">The quantity the current plan and capacity path can execute.</div>
        </div>
        <div className="card-soft p-[1.7vw]">
          <div className="flex items-baseline justify-between"><div className="display text-[2.4vw]">cannotBeMade</div><div className="text-[1.2vw] uppercase tracking-[.12em] text-[#d88366]">Residual</div></div>
          <div className="mt-[1.5vh] text-[1.6vw] leading-[1.15] text-[#d8dfda]">Demand that remains after the current execution path is exhausted.</div>
        </div>
        <div className="card p-[1.7vw]">
          <div className="flex items-baseline justify-between"><div className="display text-[2.4vw]">w1 → w4</div><div className="text-[1.2vw] uppercase tracking-[.12em] text-[#89c9c0]">Release</div></div>
          <div className="mt-[1.5vh] text-[1.6vw] leading-[1.15] text-[#d8dfda]">The weekly allocation that turns a monthly answer into an operating sequence.</div>
        </div>
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] right-[7vw] text-[1.45vw] text-[#a6b4b5]">Basis labels prevent one number from being mistaken for another.</div>
    </div>
  );
}
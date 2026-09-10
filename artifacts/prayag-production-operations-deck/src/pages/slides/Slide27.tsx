export default function Slide27() {
  return (
    <div className="w-screen h-screen overflow-hidden relative slide-shell ambient">
      <div className="absolute right-[7vw] top-[5vh] vertical-label kicker">25 / Monitoring</div>
      <div className="kicker">Monitoring hierarchy</div>
      <h1 className="slide-title mt-[2.5vh] max-w-[74vw]">Monitoring moves from plant signal to action</h1>
      <div className="mt-[5vh] grid grid-cols-4 gap-[1.1vw]">
        <div className="card p-[1.35vw] min-h-[31vh]"><div className="metric text-[#e7b24c]">01</div><div className="mt-[2vh] text-[1.8vw] display">Observe</div><div className="mt-[1.4vh] text-[1.45vw] leading-[1.15] text-[#a6b4b5]">Plant and Plumbing landings establish the selected month and operating surface.</div></div>
        <div className="card p-[1.35vw] min-h-[31vh]"><div className="metric text-[#89c9c0]">02</div><div className="mt-[2vh] text-[1.8vw] display">Compare</div><div className="mt-[1.4vh] text-[1.45vw] leading-[1.15] text-[#a6b4b5]">Velocity, attainment, trend, and backlog compare plan against actual production.</div></div>
        <div className="card-warm p-[1.35vw] min-h-[31vh]"><div className="metric text-[#e7b24c]">03</div><div className="mt-[2vh] text-[1.8vw] display">Explain</div><div className="mt-[1.4vh] text-[1.45vw] leading-[1.15] text-[#a6b4b5]">Warnings, quality, recommendations, and AI analytics surface the reason behind the gap.</div></div>
        <div className="card-soft p-[1.35vw] min-h-[31vh]"><div className="metric text-[#d88366]">04</div><div className="mt-[2vh] text-[1.8vw] display">Act</div><div className="mt-[1.4vh] text-[1.45vw] leading-[1.15] text-[#a6b4b5]">Actions, reports, machine release, and corrective planning turn signals into decisions.</div></div>
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] right-[7vw] text-[1.45vw] text-[#d8dfda]">Completed months remain immutable while current-month decisions stay operational.</div>
    </div>
  );
}
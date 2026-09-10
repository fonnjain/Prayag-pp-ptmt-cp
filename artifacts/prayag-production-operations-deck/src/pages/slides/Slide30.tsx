export default function Slide30() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0c1418]">
      <div className="absolute inset-0 grid-bg opacity-80" />
      <div className="absolute left-[7vw] top-[9vh] flex items-center gap-[1vw]">
        <div className="h-[1.2vw] w-[1.2vw] bg-[#e7b24c]" />
        <div className="kicker">28 / Operating model</div>
      </div>
      <div className="absolute left-[7vw] top-[20vh] max-w-[76vw]">
        <div className="display text-[5.5vw] font-semibold leading-[.92] tracking-[-.07em]">
          From workbook
          <br />
          <span className="text-[#e7b24c]">to action.</span>
        </div>
        <div className="mt-[3vh] max-w-[57vw] text-[1.9vw] leading-[1.15] text-[#d8dfda]">Prayag India Production Planning and Operations turns distributed evidence into a governed operating conversation.</div>
      </div>
      <div className="absolute left-[7vw] right-[7vw] bottom-[17vh] grid grid-cols-4 gap-[1.1vw]">
        <div className="card p-[1.4vw]"><div className="kicker">Planner</div><div className="mt-[1.5vh] text-[1.55vw]">Build, inspect, and issue the plan.</div></div>
        <div className="card p-[1.4vw]"><div className="kicker">Operations</div><div className="mt-[1.5vh] text-[1.55vw]">Release, monitor, and respond.</div></div>
        <div className="card-warm p-[1.4vw]"><div className="kicker">Leadership</div><div className="mt-[1.5vh] text-[1.55vw]">See risk, capacity, and trade-offs.</div></div>
        <div className="card-soft p-[1.4vw]"><div className="kicker">Audit</div><div className="mt-[1.5vh] text-[1.55vw]">Trace source, basis, and lineage.</div></div>
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] right-[7vw] flex items-end justify-between">
        <div className="text-[1.2vw] uppercase tracking-[.12em] text-[#a6b4b5]">Planning • Release • Monitor • Replan</div>
        <div className="text-right text-[1.2vw] uppercase tracking-[.12em] text-[#a6b4b5]">Prayag India<br />Production Planning and Operations</div>
      </div>
    </div>
  );
}
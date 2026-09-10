export default function Slide19() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0c1418]">
      <div className="absolute inset-0 grid-bg opacity-80" />
      <div className="absolute left-[7vw] top-[8vh] flex items-center gap-[1vw]">
        <div className="h-[1.2vw] w-[1.2vw] bg-[#e7b24c]" />
        <div className="kicker">17 / App surface</div>
      </div>
      <div className="absolute left-[7vw] top-[17vh] max-w-[76vw]">
        <div className="slide-title">
          The web app is a
          <br />
          <span className="text-[#e7b24c]">two-surface operating system</span>
        </div>
        <div className="mt-[2.5vh] text-[1.75vw] leading-[1.15] text-[#a6b4b5]">
          Planning decides what should happen. Monitoring shows what is happening.
        </div>
      </div>
      <div className="absolute left-[7vw] right-[7vw] top-[43vh] grid grid-cols-2 gap-[2vw]">
        <div className="card rounded-[1.2vw] p-[2vw]">
          <div className="flex items-center justify-between">
            <div className="display text-[2.15vw] font-semibold tracking-[-.04em] text-[#f3efe7]">Production Planning</div>
            <div className="text-[1.1vw] uppercase tracking-[.12em] text-[#e7b24c]">Plan</div>
          </div>
          <div className="mt-[1.6vh] grid grid-cols-2 gap-x-[1.7vw] gap-y-[1.2vh] text-[1.55vw] leading-[1.1] text-[#d8dfda]">
            <div><span className="text-[#89c9c0]">/data</span> source intake</div>
            <div><span className="text-[#89c9c0]">/summary</span> plan overview</div>
            <div><span className="text-[#89c9c0]">/products</span> roster detail</div>
            <div><span className="text-[#89c9c0]">/category/:slug</span> category view</div>
            <div><span className="text-[#89c9c0]">/runs</span> frozen baselines</div>
            <div><span className="text-[#89c9c0]">/export</span> issued output</div>
            <div><span className="text-[#89c9c0]">/corrective</span> governed change</div>
            <div><span className="text-[#89c9c0]">/alerts</span> input warnings</div>
          </div>
          <div className="mt-[2vh] rule" />
          <div className="mt-[1.4vh] text-[1.35vw] uppercase tracking-[.1em] text-[#a6b4b5]">Month + segment aware · authenticated · admin controls</div>
        </div>
        <div className="card-warm rounded-[1.2vw] p-[2vw]">
          <div className="flex items-center justify-between">
            <div className="display text-[2.15vw] font-semibold tracking-[-.04em] text-[#f3efe7]">Production Monitoring</div>
            <div className="text-[1.1vw] uppercase tracking-[.12em] text-[#e7b24c]">Operate</div>
          </div>
          <div className="mt-[1.6vh] grid grid-cols-2 gap-x-[1.7vw] gap-y-[1.2vh] text-[1.55vw] leading-[1.1] text-[#d8dfda]">
            <div><span className="text-[#89c9c0]">/plant</span> PTMT landing</div>
            <div><span className="text-[#89c9c0]">/plant/velocity</span> run rate</div>
            <div><span className="text-[#89c9c0]">/plant/trend</span> history</div>
            <div><span className="text-[#89c9c0]">/plant/reports</span> reporting</div>
            <div><span className="text-[#89c9c0]">/plumbing</span> Plumbing landing</div>
            <div><span className="text-[#89c9c0]">/plumbing/machine-release</span> release</div>
            <div><span className="text-[#89c9c0]">/plumbing/warnings</span> warnings</div>
            <div><span className="text-[#89c9c0]">/plumbing/quality</span> quality</div>
          </div>
          <div className="mt-[2vh] rule" />
          <div className="mt-[1.4vh] text-[1.35vw] uppercase tracking-[.1em] text-[#a6b4b5]">Actuals · RAG · machine context · immutable month history</div>
        </div>
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] right-[7vw] flex items-center gap-[1.2vw]">
        <div className="h-[.35vw] w-[5vw] bg-[#89c9c0]" />
        <div className="text-[1.45vw] tracking-[.04em] text-[#d8dfda]">One evidence model connects the two surfaces.</div>
        <div className="ml-auto text-[1.2vw] uppercase tracking-[.12em] text-[#a6b4b5]">Source → plan → release → actual → correction</div>
      </div>
    </div>
  );
}
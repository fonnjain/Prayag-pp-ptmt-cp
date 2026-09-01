export default function Slide18() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0c1418]">
      <div className="absolute inset-0 grid-bg opacity-80" />
      <div className="absolute left-[7vw] top-[10vh] flex items-center gap-[1vw]">
        <div className="h-[1.2vw] w-[1.2vw] bg-[#e7b24c]" />
        <div className="kicker">Prayag India / Next operating priorities</div>
      </div>
      <div className="absolute left-[7vw] top-[27vh] max-w-[64vw]">
        <div className="display text-[5.2vw] font-semibold leading-[.93] tracking-[-.07em]">
          Next operating
          <br />
          <span className="text-[#e7b24c]">priorities</span>
        </div>
      </div>
      <div className="absolute right-[7vw] top-[25vh] w-[33vw] space-y-[2.4vh]">
        <div className="bullet-row"><div className="bullet-mark">01</div><div className="bullet-text">Continue strengthening current-pending reconciliation for Plumbing</div></div>
        <div className="bullet-row"><div className="bullet-mark">02</div><div className="bullet-text">Add explicit staleness protection for planning uploads</div></div>
        <div className="bullet-row"><div className="bullet-mark">03</div><div className="bullet-text">Keep uploaded and live evidence approvals independent</div></div>
        <div className="bullet-row"><div className="bullet-mark">04</div><div className="bullet-text">Run the Plumbing machine schedule end to end</div></div>
        <div className="bullet-row"><div className="bullet-mark">05</div><div className="bullet-text">Expand the same provenance standard across every planning path</div></div>
      </div>
      <div className="absolute bottom-[8vh] left-[7vw] right-[7vw] flex items-end justify-between">
        <div className="text-[1.25vw] uppercase tracking-[.12em] text-[#a6b4b5]">Planning • Release • Monitor • Replan</div>
        <div className="text-right text-[1.25vw] uppercase tracking-[.12em] text-[#a6b4b5]">Prayag India<br />Production Planning {"&"} Operations</div>
      </div>
    </div>
  );
}

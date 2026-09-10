export default function Slide20() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0c1418]">
      <div className="absolute inset-0 ambient opacity-90" />
      <div className="absolute left-[7vw] top-[8vh] flex items-center gap-[1vw]">
        <div className="h-[1.2vw] w-[1.2vw] bg-[#e7b24c]" />
        <div className="kicker">18 / Current operating position</div>
      </div>
      <div className="absolute left-[7vw] top-[18vh] max-w-[70vw]">
        <div className="slide-title">
          The app is built around
          <br />
          <span className="text-[#e7b24c]">visible truth, not silent assumptions</span>
        </div>
      </div>
      <div className="absolute left-[7vw] right-[7vw] top-[43vh] grid grid-cols-3 gap-[1.6vw]">
        <div className="card rounded-[1.1vw] p-[1.8vw]">
          <div className="text-[1.2vw] uppercase tracking-[.14em] text-[#89c9c0]">Established</div>
          <div className="mt-[1.7vh] space-y-[1.3vh] text-[1.55vw] leading-[1.14] text-[#d8dfda]">
            <div>Finalized Production Plans provide an operational baseline.</div>
            <div>PTMT and Plumbing have separate planning and monitoring paths.</div>
            <div>Evidence, run lineage, demand basis, and deferred quantities remain explicit.</div>
          </div>
        </div>
        <div className="card-warm rounded-[1.1vw] p-[1.8vw]">
          <div className="text-[1.2vw] uppercase tracking-[.14em] text-[#e7b24c]">Verified controls</div>
          <div className="mt-[1.7vh] space-y-[1.3vh] text-[1.55vw] leading-[1.14] text-[#d8dfda]">
            <div>Plumbing Pass 2 reaches the direct plant scheduler and returned HTTP 200 in a one-line probe.</div>
            <div>Missing machine residual fields fail explicitly; they do not become zero.</div>
            <div>Scheduler failure returns a named error; there is no silent local fallback.</div>
          </div>
        </div>
        <div className="card-soft rounded-[1.1vw] p-[1.8vw]">
          <div className="text-[1.2vw] uppercase tracking-[.14em] text-[#d88366]">Held for review</div>
          <div className="mt-[1.7vh] space-y-[1.3vh] text-[1.55vw] leading-[1.14] text-[#d8dfda]">
            <div>September Plumbing remains gated by the reviewed stock-join fingerprint and ceiling.</div>
            <div>Local Plumbing category capacity is thin-data evidence, not a substitute for Pass 2.</div>
            <div>End-to-end September scheduling remains a controlled next step.</div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-[8vh] left-[7vw] right-[7vw] flex items-end justify-between">
        <div>
          <div className="text-[2.15vw] font-semibold tracking-[-.03em] text-[#f3efe7]">The operating standard</div>
          <div className="mt-[.8vh] text-[1.35vw] text-[#a6b4b5]">Every quantity has a basis. Every baseline has lineage. Every limitation stays visible.</div>
        </div>
        <div className="text-right text-[1.2vw] uppercase tracking-[.12em] text-[#a6b4b5]">Prayag India<br />Production Planning &amp; Operations</div>
      </div>
    </div>
  );
}
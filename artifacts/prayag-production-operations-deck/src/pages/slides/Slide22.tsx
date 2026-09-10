export default function Slide22() {
  return (
    <div className="w-screen h-screen overflow-hidden relative slide-shell ambient">
      <div className="absolute right-[7vw] top-[5vh] vertical-label kicker">20 / Intake</div>
      <div className="kicker">Source contracts</div>
      <h1 className="slide-title mt-[2.5vh] max-w-[72vw]">Source intake follows a contract</h1>
      <div className="mt-[5vh] grid grid-cols-3 gap-[1.5vw]">
        <div className="card p-[1.7vw] min-h-[34vh]">
          <div className="text-[1.25vw] uppercase tracking-[.14em] text-[#89c9c0]">PTMT inputs</div>
          <div className="mt-[2vh] space-y-[1.4vh] text-[1.65vw] leading-[1.12]">
            <div>Current stock</div>
            <div>Pending orders</div>
            <div>Last-month pending</div>
            <div>Rate list and catalogue</div>
          </div>
          <div className="mt-[3vh] caption">Workbook identity and period semantics travel with the upload.</div>
        </div>
        <div className="card-warm p-[1.7vw] min-h-[34vh]">
          <div className="text-[1.25vw] uppercase tracking-[.14em] text-[#e7b24c]">Plumbing inputs</div>
          <div className="mt-[2vh] space-y-[1.4vh] text-[1.65vw] leading-[1.12]">
            <div>FG Stock workbook</div>
            <div>Daily-production workbook</div>
            <div>Pipe and fitting BOM</div>
            <div>Pending and production evidence</div>
          </div>
          <div className="mt-[3vh] caption">The FG Stock worksheet is selected explicitly; mirrored tabs are not substituted.</div>
        </div>
        <div className="card-soft p-[1.7vw] min-h-[34vh]">
          <div className="text-[1.25vw] uppercase tracking-[.14em] text-[#d88366]">Validation gate</div>
          <div className="mt-[2vh] space-y-[1.4vh] text-[1.65vw] leading-[1.12]">
            <div>Recognised sheet</div>
            <div>Required headers</div>
            <div>Non-empty data rows</div>
            <div>Reconciliation and freshness</div>
          </div>
          <div className="mt-[3vh] caption">Failed checks remain visible as named errors rather than becoming zero-data plans.</div>
        </div>
      </div>
      <div className="absolute bottom-[7vh] left-[7vw] right-[7vw] flex items-center gap-[1.2vw]">
        <div className="h-[.35vw] w-[5vw] bg-[#89c9c0]" />
        <div className="text-[1.45vw] text-[#d8dfda]">A source is usable only when its shape and meaning are both understood.</div>
      </div>
    </div>
  );
}
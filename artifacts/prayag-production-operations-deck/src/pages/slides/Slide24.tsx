export default function Slide24() {
  return (
    <div className="w-screen h-screen overflow-hidden relative slide-shell ambient">
      <div className="absolute right-[7vw] top-[5vh] vertical-label kicker">22 / Plumbing</div>
      <div className="kicker">Planning model / Plumbing</div>
      <h1 className="slide-title mt-[2.5vh] max-w-[74vw]">Plumbing planning is family-led and workbook-backed</h1>
      <div className="mt-[5vh] grid grid-cols-2 gap-[2vw]">
        <div className="card-warm p-[2vw]">
          <div className="text-[1.25vw] uppercase tracking-[.14em] text-[#e7b24c]">12 canonical categories</div>
          <div className="mt-[2.5vh] grid grid-cols-2 gap-y-[1.3vh] text-[1.6vw]">
            <div>CPVC Pipe</div><div>CPVC Fitting</div>
            <div>UPVC Pipe</div><div>UPVC Fitting</div>
            <div>SWR Pipe</div><div>SWR Fitting</div>
            <div>AGRI Pipe</div><div>AGRI Fitting</div>
            <div>CPVC Solvent</div><div>UPVC Solvent</div>
            <div>SWR Solvent</div><div>AGRI Solvent</div>
          </div>
        </div>
        <div className="card p-[2vw]">
          <div className="text-[1.25vw] uppercase tracking-[.14em] text-[#89c9c0]">Source semantics</div>
          <div className="mt-[2.5vh] space-y-[1.55vh] text-[1.6vw] leading-[1.14]">
            <div><span className="text-[#e7b24c]">FG Stock:</span> positive Net Stock becomes opening stock.</div>
            <div><span className="text-[#e7b24c]">Negative Net Stock:</span> pending-last-month evidence.</div>
            <div><span className="text-[#e7b24c]">Daily workbook:</span> planning, production, and BOM context.</div>
            <div><span className="text-[#e7b24c]">Trading rows:</span> solvents are detected by item name; other trading rows are excluded.</div>
          </div>
        </div>
      </div>
      <div className="mt-[3vh] card-soft p-[1.5vw] text-[1.5vw] text-[#a6b4b5]">The Plumbing contract does not read a mirrored Pending Prod. tab as a replacement for the FG Stock worksheet.</div>
      <div className="footer-mark"><span>Prayag India</span><span>Plumbing family and source model</span></div>
    </div>
  );
}
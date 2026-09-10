export default function Slide26() {
  return (
    <div className="w-screen h-screen overflow-hidden relative slide-shell ambient">
      <div className="absolute right-[7vw] top-[5vh] vertical-label kicker">24 / Capacity</div>
      <div className="kicker">Two capacity layers</div>
      <h1 className="slide-title mt-[2.5vh] max-w-[74vw]">Capacity is evidence plus execution</h1>
      <div className="mt-[5vh] grid grid-cols-2 gap-[2vw]">
        <div className="card p-[2vw]">
          <div className="kicker">Layer 01 / Category</div>
          <div className="mt-[2vh] display text-[3vw] leading-[.98] tracking-[-.05em]">How much can the category usually make?</div>
          <div className="mt-[3vh] space-y-[1.4vh] text-[1.6vw] leading-[1.12] text-[#d8dfda]">
            <div>Historical observations and positive-production days</div>
            <div>P90-based suggestions and approved overrides</div>
            <div>Method, sample count, and thin-data status</div>
            <div>Segment isolation for PTMT and Plumbing</div>
          </div>
        </div>
        <div className="card-warm p-[2vw]">
          <div className="kicker text-[#e7b24c]">Layer 02 / Machine</div>
          <div className="mt-[2vh] display text-[3vw] leading-[.98] tracking-[-.05em]">What can the machines execute now?</div>
          <div className="mt-[3vh] space-y-[1.4vh] text-[1.6vw] leading-[1.12] text-[#d8dfda]">
            <div>PTMT machine cascade and weekly release</div>
            <div>Plumbing pipe and fitting scheduler</div>
            <div>Machine lockouts, idle hours, and residuals</div>
            <div>Explicit failure when external scheduling is unavailable</div>
          </div>
        </div>
      </div>
      <div className="footer-mark"><span>Prayag India</span><span>Capacity intelligence</span></div>
    </div>
  );
}
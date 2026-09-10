export default function Slide21() {
  return (
    <div className="w-screen h-screen overflow-hidden relative slide-shell ambient">
      <div className="absolute right-[7vw] top-[5vh] vertical-label kicker">19 / Context</div>
      <div className="kicker">The first decision</div>
      <h1 className="slide-title mt-[2.5vh] max-w-[72vw]">Start with a governed context</h1>
      <div className="mt-[6vh] grid grid-cols-[.9fr_1.1fr] gap-[3vw] items-start">
        <div className="card-warm p-[2.2vw]">
          <div className="text-[1.25vw] uppercase tracking-[.14em] text-[#e7b24c]">Every screen is scoped by</div>
          <div className="mt-[2.4vh] space-y-[1.8vh]">
            <div className="display text-[2.5vw] tracking-[-.04em]">Who can act</div>
            <div className="display text-[2.5vw] tracking-[-.04em]">Which month</div>
            <div className="display text-[2.5vw] tracking-[-.04em]">Which segment</div>
          </div>
        </div>
        <div className="space-y-[2.3vh]">
          <div className="bullet-row"><div className="bullet-mark">01</div><div className="bullet-text">Authenticated users enter through the shared login boundary.</div></div>
          <div className="bullet-row"><div className="bullet-mark">02</div><div className="bullet-text">The month filter keeps planning, monitoring, and reporting aligned.</div></div>
          <div className="bullet-row"><div className="bullet-mark">03</div><div className="bullet-text">The PTMT and Plumbing segment switch changes the data contract, roster, and operating logic.</div></div>
          <div className="bullet-row"><div className="bullet-mark">04</div><div className="bullet-text">Admin-only surfaces manage users and configuration without opening those controls to everyone.</div></div>
        </div>
      </div>
      <div className="footer-mark"><span>Prayag India</span><span>Context before calculation</span></div>
    </div>
  );
}
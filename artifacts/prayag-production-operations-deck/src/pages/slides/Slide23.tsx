export default function Slide23() {
  return (
    <div className="w-screen h-screen overflow-hidden relative slide-shell ambient">
      <div className="absolute right-[7vw] top-[5vh] vertical-label kicker">21 / PTMT</div>
      <div className="kicker">Planning model / PTMT</div>
      <h1 className="slide-title mt-[2.5vh] max-w-[74vw]">PTMT planning keeps item and colour identity</h1>
      <div className="mt-[5vh] grid grid-cols-[1.15fr_.85fr] gap-[3vw]">
        <div className="card p-[1.8vw]">
          <div className="kicker">Plan construction</div>
          <div className="mt-[2.5vh] space-y-[1.4vh]">
            <div className="flex items-center gap-[1vw]"><div className="w-[9vw] text-[1.35vw] text-[#a6b4b5]">Catalogue</div><div className="h-[3.4vh] flex-1 bg-[#89c9c0]/35" /></div>
            <div className="flex items-center gap-[1vw]"><div className="w-[9vw] text-[1.35vw] text-[#a6b4b5]">Sales history</div><div className="h-[3.4vh] flex-1 bg-[#89c9c0]/55" /></div>
            <div className="flex items-center gap-[1vw]"><div className="w-[9vw] text-[1.35vw] text-[#a6b4b5]">Stock</div><div className="h-[3.4vh] flex-1 bg-[#e7b24c]/60" /></div>
            <div className="flex items-center gap-[1vw]"><div className="w-[9vw] text-[1.35vw] text-[#a6b4b5]">Pending</div><div className="h-[3.4vh] flex-1 bg-[#d88366]/55" /></div>
            <div className="flex items-center gap-[1vw]"><div className="w-[9vw] text-[1.35vw] text-[#a6b4b5]">Buffer</div><div className="h-[3.4vh] flex-1 bg-[#89c9c0]/75" /></div>
          </div>
          <div className="mt-[3vh] text-[1.6vw] text-[#d8dfda]">Demand is calculated at the code-and-colour grain before it becomes a category or machine decision.</div>
        </div>
        <div className="space-y-[2vh]">
          <div className="card-warm p-[1.8vw]">
            <div className="text-[1.2vw] uppercase tracking-[.14em] text-[#e7b24c]">Identity retained</div>
            <div className="mt-[1.8vh] text-[2.1vw] leading-[1.03] display">Item code<br />+ colour<br />+ category</div>
          </div>
          <div className="card-soft p-[1.8vw] text-[1.55vw] leading-[1.15]">
            The roster begins with the active stock opening and joins sales and pending evidence deliberately. Unresolved classifications remain unresolved.
          </div>
        </div>
      </div>
      <div className="footer-mark"><span>Prayag India</span><span>PTMT item-and-colour plan</span></div>
    </div>
  );
}
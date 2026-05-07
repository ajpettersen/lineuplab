import React from "react";
import { ChevronUp, ChevronDown, ChevronLeft, X, Maximize2, Menu, GripHorizontal } from "lucide-react";

export function PortraitDrawer() {
  const batters = [
    { num: 1, name: "Noah L.", pos: "SS", active: true },
    { num: 2, name: "Marcus J.", pos: "P", active: false },
    { num: 3, name: "Diego R.", pos: "C", active: false },
    { num: 4, name: "Tyler K.", pos: "1B", active: false },
    { num: 5, name: "Hunter M.", pos: "3B", active: false },
    { num: 6, name: "Aiden P.", pos: "2B", active: false },
    { num: 7, name: "Mason B.", pos: "LF", active: false },
    { num: 8, name: "Logan S.", pos: "CF", active: false },
    { num: 9, name: "Owen T.", pos: "RF", active: false },
    { num: 10, name: "Liam W.", pos: "BENCH", active: false },
    { num: 11, name: "Ethan G.", pos: "BENCH", active: false },
    { num: 12, name: "Jackson D.", pos: "BENCH", active: false },
  ];

  return (
    <div className="w-full min-h-screen bg-neutral-900 p-8 flex flex-col md:flex-row gap-8 items-start justify-center overflow-auto font-sans">
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Roboto+Mono:wght@500;700&display=swap');
        
        .broadcast-panel {
          background: linear-gradient(135deg, #0A192F 0%, #050d1a 100%);
          border: 1px solid #1a2a42;
        }
        
        .accent-gold {
          color: #FFC107;
        }
        
        .bg-accent-gold {
          background-color: #FFC107;
          color: #000;
        }

        .stripe-row:nth-child(even) {
          background-color: rgba(255, 255, 255, 0.03);
        }

        .field-grass {
          background: radial-gradient(circle at 50% 20%, #022010 0%, #010a05 100%);
          background-image: 
            repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(255,255,255,0.02) 40px, rgba(255,255,255,0.02) 80px),
            radial-gradient(circle at 50% 20%, #022010 0%, #010a05 100%);
        }

        .basepath {
          border: 2px solid rgba(255,255,255,0.6);
          box-shadow: 0 0 10px rgba(255,255,255,0.2);
          transform: rotate(45deg);
        }

        .drawer-shadow {
          box-shadow: 0 -10px 40px rgba(0,0,0,0.8);
        }

        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />

      {/* Frame 1: Peek State */}
      <div className="w-[390px] h-[844px] bg-[#000000] text-white flex flex-col font-['Oswald'] relative overflow-hidden shadow-2xl rounded-[40px] border-[8px] border-neutral-800 shrink-0">
        <Header />
        <FieldArea />
        <DrawerPeek batters={batters} />
      </div>

      {/* Frame 2: Expanded State */}
      <div className="w-[390px] h-[844px] bg-[#000000] text-white flex flex-col font-['Oswald'] relative overflow-hidden shadow-2xl rounded-[40px] border-[8px] border-neutral-800 shrink-0">
        <Header />
        <FieldArea />
        <DrawerExpanded batters={batters} />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="h-[85px] w-full flex bg-[#0A192F] border-b-2 border-[#FFC107] shadow-[0_4px_20px_rgba(0,0,0,0.8)] z-20 relative shrink-0">
      {/* Inning Controls */}
      <div className="w-[85px] h-full flex flex-col items-center justify-center border-r border-[#1a2a42] bg-[#050d1a] relative overflow-hidden">
        <div className="absolute inset-0 bg-[#FFC107] opacity-10"></div>
        <button className="text-gray-400 hover:text-[#FFC107] transition-colors"><ChevronUp size={20} strokeWidth={3} /></button>
        <div className="flex items-center gap-1 my-0.5">
          <span className="text-[#FFC107] text-[10px] leading-none">▲</span>
          <span className="font-['Roboto_Mono'] text-xl font-bold leading-none">3RD</span>
        </div>
        <button className="text-gray-400 hover:text-white transition-colors"><ChevronDown size={20} strokeWidth={3} /></button>
      </div>

      {/* Score / Matchup */}
      <div className="flex-1 flex flex-col items-center justify-center px-2">
        <div className="flex w-full items-center justify-between mb-1">
          <div className="text-sm font-bold tracking-widest text-gray-300">TIGERS</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">vs</div>
          <div className="text-sm font-bold tracking-widest accent-gold">WILDCATS</div>
        </div>
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1">
            <button className="text-gray-500 hover:text-white"><ChevronDown size={16} /></button>
            <div className="font-['Roboto_Mono'] text-3xl font-bold leading-none">2</div>
            <button className="text-gray-500 hover:text-white"><ChevronUp size={16} /></button>
          </div>
          <div className="flex items-center gap-1">
            <button className="text-gray-500 hover:text-[#FFC107]"><ChevronDown size={16} /></button>
            <div className="font-['Roboto_Mono'] text-3xl font-bold leading-none accent-gold">4</div>
            <button className="text-gray-500 hover:text-[#FFC107]"><ChevronUp size={16} /></button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="w-[60px] h-full flex flex-col items-center justify-around border-l border-[#1a2a42] py-2">
        <button className="w-8 h-8 rounded-full bg-[#1a2a42] flex items-center justify-center text-gray-300 hover:text-white">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function FieldArea() {
  return (
    <div className="absolute top-[85px] left-0 right-0 bottom-0 field-grass z-10 flex flex-col items-center overflow-hidden">
      {/* Vignette */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none"></div>

      {/* Diamond Abstraction */}
      <div className="absolute w-[240px] h-[240px] basepath top-[40%] left-1/2 -ml-[120px] -mt-[120px]" />
      
      {/* Bases */}
      <div className="absolute w-8 h-8 bg-white/20 rounded-full top-[40%] left-1/2 -ml-4 mt-[104px]" /> {/* Home */}
      <div className="absolute w-10 h-10 bg-[rgba(200,180,140,0.15)] rounded-full top-[40%] left-1/2 -ml-5 -mt-5" /> {/* Mound */}
      
      {/* Dirt Arcs */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30" viewBox="0 0 390 700">
        <path d="M 50 360 Q 195 240 340 360" fill="none" stroke="#C8B48C" strokeWidth="2" />
        <path d="M -20 180 Q 195 40 410 180" fill="none" stroke="white" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
      </svg>

      {/* Position Chips */}
      {[
        { pos: "C", name: "Diego R.", x: "50%", y: "58%" },
        { pos: "P", name: "Marcus J.", x: "50%", y: "40%" },
        { pos: "1B", name: "Tyler K.", x: "82%", y: "35%" },
        { pos: "2B", name: "Aiden P.", x: "68%", y: "22%" },
        { pos: "SS", name: "Noah L.", x: "32%", y: "22%" },
        { pos: "3B", name: "Hunter M.", x: "18%", y: "35%" },
        { pos: "LF", name: "Mason B.", x: "15%", y: "8%" },
        { pos: "CF", name: "Logan S.", x: "50%", y: "5%" },
        { pos: "RF", name: "Owen T.", x: "85%", y: "8%" },
      ].map((p, i) => (
        <div 
          key={i} 
          className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 shadow-2xl z-20"
          style={{ left: p.x, top: p.y }}
        >
          <div className="bg-[#0A192F] border border-[#1a2a42] flex overflow-hidden rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.9)] cursor-pointer active:scale-95 transition-transform">
            <div className="bg-[#FFC107] text-black font-bold font-['Roboto_Mono'] w-8 flex items-center justify-center text-sm">
              {p.pos}
            </div>
            <div className="px-2 py-1 font-bold text-sm whitespace-nowrap tracking-wide">
              {p.name}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DrawerPeek({ batters }: { batters: any[] }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[140px] broadcast-panel drawer-shadow rounded-t-3xl z-30 flex flex-col">
      <div className="w-full flex justify-center pt-3 pb-2 cursor-grab">
        <div className="w-12 h-1.5 bg-gray-600 rounded-full"></div>
      </div>
      
      {/* Bench Strip */}
      <div className="w-full overflow-x-auto hide-scrollbar px-4 pb-3 flex items-center gap-3 border-b border-[#1a2a42]">
        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold shrink-0 mr-1">Bench</div>
        {["Liam W.", "Ethan G.", "Jackson D."].map((name, i) => (
          <div key={i} className="px-3 py-1.5 bg-[#112240] border border-[#1a2a42] rounded shrink-0 font-bold text-sm text-gray-300 shadow-inner">
            {name}
          </div>
        ))}
      </div>

      {/* Next Batters Condensed */}
      <div className="flex-1 flex items-center px-4 gap-4">
        <div className="text-[10px] text-[#FFC107] uppercase tracking-widest font-bold shrink-0">Up Next</div>
        <div className="flex flex-1 items-center gap-3 overflow-hidden">
          {batters.slice(0, 3).map((b, i) => (
            <div key={i} className="flex items-center gap-1.5 shrink-0">
              <span className={`font-['Roboto_Mono'] text-xs ${i === 0 ? 'text-[#FFC107] font-bold' : 'text-gray-500'}`}>{b.num}</span>
              <span className={`text-sm font-bold truncate ${i === 0 ? 'text-white' : 'text-gray-400'}`}>{b.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DrawerExpanded({ batters }: { batters: any[] }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 top-[120px] broadcast-panel drawer-shadow rounded-t-3xl z-30 flex flex-col">
      <div className="w-full flex justify-center pt-3 pb-4 cursor-pointer shrink-0">
        <div className="w-12 h-1.5 bg-gray-600 rounded-full"></div>
      </div>
      
      <div className="flex-1 overflow-y-auto hide-scrollbar flex flex-col">
        {/* Full Bench Grid */}
        <div className="px-5 pb-6">
          <div className="text-sm text-gray-400 uppercase tracking-widest font-bold mb-3 flex items-center justify-between">
            <span>Bench</span>
            <span className="text-[#FFC107] text-xs bg-[#FFC107]/10 px-2 py-0.5 rounded">3 Players</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {["Liam W.", "Ethan G.", "Jackson D."].map((name, i) => (
              <div key={i} className="px-3 py-3 bg-[#112240] border border-[#1a2a42] rounded flex items-center justify-between shadow-sm">
                <span className="font-bold text-sm text-gray-200">{name}</span>
                <span className="text-[10px] text-gray-500 font-['Roboto_Mono']">OUT</span>
              </div>
            ))}
          </div>
        </div>

        {/* Full Lineup */}
        <div className="flex-1 border-t border-[#1a2a42] bg-[#050d1a]/50">
          <div className="px-5 py-4 sticky top-0 bg-[#050d1a]/95 backdrop-blur z-10 border-b border-[#1a2a42]">
            <h2 className="text-lg font-bold tracking-widest uppercase accent-gold flex items-center gap-2">
              Batting Order
              <span className="text-xs text-gray-500 font-normal tracking-normal">(12)</span>
            </h2>
          </div>
          
          <div className="px-3 py-2 pb-8">
            {batters.map((batter, i) => (
              <div 
                key={i} 
                className={`flex items-stretch h-[48px] mb-1 rounded overflow-hidden stripe-row transition-all
                  ${batter.active ? 'bg-[#1a2a42] border border-[#FFC107] shadow-lg' : 'border border-transparent'}
                `}
              >
                <div className="w-8 flex items-center justify-center text-gray-500">
                  <GripHorizontal size={14} opacity={0.5} />
                </div>
                <div className={`w-10 flex items-center justify-center font-['Roboto_Mono'] font-bold text-lg
                  ${batter.active ? 'bg-[#FFC107] text-black' : 'bg-[rgba(255,255,255,0.05)] text-gray-400'}
                `}>
                  {batter.num}
                </div>
                <div className="flex-1 flex items-center justify-between px-4">
                  <div className={`font-bold text-lg tracking-wide ${batter.active ? 'text-white' : 'text-gray-200'}`}>
                    {batter.name}
                  </div>
                  <div className={`font-['Roboto_Mono'] text-sm font-bold 
                    ${batter.pos === 'BENCH' ? 'text-gray-600' : (batter.active ? 'text-[#FFC107]' : 'text-gray-400')}
                  `}>
                    {batter.pos}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

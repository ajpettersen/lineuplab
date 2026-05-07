import React from "react";
import { ChevronUp, ChevronDown, ChevronLeft } from "lucide-react";

export function PortraitDeck() {
  return (
    <div className="w-[390px] h-[844px] bg-[#050d1a] text-white flex flex-col font-['Oswald'] overflow-hidden shadow-2xl border border-[#1a2a42]">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Roboto+Mono:wght@500;700&display=swap');
        
        .broadcast-bg {
          background: linear-gradient(135deg, #0A192F 0%, #050d1a 100%);
        }
        
        .accent-gold {
          color: #FFC107;
        }
        
        .bg-accent-gold {
          background-color: #FFC107;
          color: #000;
        }
        
        .chyron-header {
          background: linear-gradient(90deg, #1a2a42 0%, #0A192F 100%);
          border-top: 2px solid #FFC107;
        }
        
        .field-grass {
          background: #022010;
          background-image: repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(255,255,255,0.02) 20px, rgba(255,255,255,0.02) 40px);
        }
        
        .basepath {
          border: 1px solid rgba(255,255,255,0.4);
          transform: rotate(45deg);
        }
        
        .batter-row-active {
          animation: pulse-gold 2s infinite;
        }
        
        @keyframes pulse-gold {
          0% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.4); border-color: rgba(255, 193, 7, 0.8); }
          70% { box-shadow: 0 0 0 4px rgba(255, 193, 7, 0); border-color: rgba(255, 193, 7, 0.4); }
          100% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0); border-color: rgba(255, 193, 7, 0.8); }
        }
        
        /* Hide scrollbar */
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />

      {/* Header (~110px) */}
      <div className="h-[110px] w-full flex flex-col bg-[#0A192F] border-b-2 border-[#FFC107] z-10 shrink-0 shadow-[0_4px_15px_rgba(0,0,0,0.6)] relative">
        {/* Top bar with back button */}
        <div className="h-6 w-full flex items-center px-2 opacity-60">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-xs uppercase tracking-widest">Exit</span>
        </div>
        
        <div className="flex-1 flex items-center justify-between px-4 pb-2">
          {/* Away Team */}
          <div className="flex flex-col items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-xl font-bold shadow-inner">
              T
            </div>
            <div className="text-[10px] tracking-widest text-slate-400 mt-1 uppercase">Tigers</div>
          </div>

          {/* Scores */}
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <button className="w-6 h-4 bg-[#FFC107] flex items-center justify-center rounded-t border border-black text-black hover:bg-yellow-300">
                <ChevronUp className="w-3 h-3" />
              </button>
              <div className="text-4xl font-bold font-['Roboto_Mono'] text-white leading-none py-1">2</div>
              <button className="w-6 h-4 bg-slate-800 flex items-center justify-center rounded-b border border-black text-[#FFC107] hover:bg-slate-700">
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            
            <div className="flex flex-col items-center px-2">
              <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Inning</div>
              <div className="flex items-center gap-1">
                <span className="text-[#FFC107] text-sm">▲</span>
                <span className="text-2xl font-bold font-['Roboto_Mono'] text-white">3RD</span>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <button className="w-6 h-4 bg-[#FFC107] flex items-center justify-center rounded-t border border-black text-black hover:bg-yellow-300">
                <ChevronUp className="w-3 h-3" />
              </button>
              <div className="text-4xl font-bold font-['Roboto_Mono'] accent-gold leading-none py-1">4</div>
              <button className="w-6 h-4 bg-slate-800 flex items-center justify-center rounded-b border border-black text-[#FFC107] hover:bg-slate-700">
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Home Team */}
          <div className="flex flex-col items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-red-800 flex items-center justify-center text-xl font-bold shadow-inner border border-red-900">
              W
            </div>
            <div className="text-[10px] tracking-widest accent-gold mt-1 uppercase">Wildcats</div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-[#03060a] overflow-hidden">
        
        {/* Field Card (~280px) */}
        <div className="h-[280px] shrink-0 border-b border-[#1a2a42] flex flex-col relative">
          <div className="chyron-header py-1 px-3 flex items-center justify-between z-10 shadow-md">
            <span className="text-xs font-bold tracking-widest uppercase">Defense — Top 3rd</span>
            <span className="text-[10px] text-[#FFC107] font-['Roboto_Mono']">00:42</span>
          </div>
          
          <div className="flex-1 field-grass relative overflow-hidden flex items-center justify-center shadow-inner">
            {/* Diamond */}
            <div className="absolute w-[180px] h-[180px] basepath top-[40%] left-1/2 -ml-[90px] -mt-[90px]" />
            <div className="absolute w-[40px] h-[40px] bg-[rgba(255,255,255,0.1)] rounded-full bottom-[-5px] left-1/2 -ml-[20px]" />
            <div className="absolute w-[30px] h-[30px] bg-[rgba(255,255,255,0.1)] rounded-full top-[105px] left-1/2 -ml-[15px]" />

            {/* Position Chips */}
            {[
              { pos: "C", name: "DIEGO", x: "50%", y: "85%" },
              { pos: "P", name: "MARCUS", x: "50%", y: "55%" },
              { pos: "1B", name: "TYLER", x: "78%", y: "45%" },
              { pos: "2B", name: "AIDEN", x: "65%", y: "25%" },
              { pos: "SS", name: "NOAH", x: "35%", y: "25%" },
              { pos: "3B", name: "HUNTER", x: "22%", y: "45%" },
              { pos: "LF", name: "MASON", x: "20%", y: "10%" },
              { pos: "CF", name: "LOGAN", x: "50%", y: "5%" },
              { pos: "RF", name: "OWEN", x: "80%", y: "10%" },
            ].map((p, i) => (
              <div 
                key={i} 
                className="absolute flex items-center transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing hover:scale-105 transition-transform"
                style={{ left: p.x, top: p.y }}
              >
                <div className="bg-[#0A192F] border border-[#1a2a42] rounded-full flex items-center overflow-hidden shadow-[0_4px_10px_rgba(0,0,0,0.8)] text-[10px]">
                  <div className="bg-[#FFC107] text-black font-bold font-['Roboto_Mono'] w-5 h-5 flex items-center justify-center">
                    {p.pos}
                  </div>
                  <div className="px-2 font-bold tracking-wider text-gray-200">
                    {p.name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bench Strip (~80px) */}
        <div className="h-[80px] shrink-0 border-b border-[#1a2a42] flex flex-col bg-[#050d1a]">
          <div className="chyron-header py-1 px-3 shadow-md flex items-center justify-between">
            <span className="text-xs font-bold tracking-widest uppercase">Dugout (3)</span>
          </div>
          <div className="flex-1 flex items-center px-3 gap-2 overflow-x-auto no-scrollbar">
            {["Liam W.", "Ethan G.", "Jackson D."].map((name, i) => (
              <div key={i} className="flex items-center bg-[#0A192F] border border-[#1a2a42] rounded-full pl-1 pr-3 py-1 shadow-sm shrink-0 cursor-pointer hover:bg-[#1a2a42] transition-colors">
                <div className="bg-slate-700 text-[#FFC107] text-[9px] font-['Roboto_Mono'] font-bold rounded-full w-6 h-6 flex items-center justify-center mr-2 shadow-inner">
                  BN
                </div>
                <span className="text-sm font-bold text-gray-300">{name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Batting Order (~270px) */}
        <div className="flex-1 flex flex-col bg-[#0A192F] min-h-0 relative">
          <div className="chyron-header py-1 px-3 shadow-md sticky top-0 z-10">
            <span className="text-xs font-bold tracking-widest uppercase">Batting Order</span>
          </div>
          
          <div className="flex-1 overflow-y-auto no-scrollbar p-2 grid grid-cols-2 gap-2 content-start pb-6">
            {[
              { num: 1, name: "Noah L.", pos: "SS", active: true },
              { num: 2, name: "Marcus J.", pos: "P", active: false },
              { num: 3, name: "Diego R.", pos: "C", active: false },
              { num: 4, name: "Tyler K.", pos: "1B", active: false },
              { num: 5, name: "Hunter M.", pos: "3B", active: false },
              { num: 6, name: "Aiden P.", pos: "2B", active: false },
              { num: 7, name: "Mason B.", pos: "LF", active: false },
              { num: 8, name: "Logan S.", pos: "CF", active: false },
              { num: 9, name: "Owen T.", pos: "RF", active: false },
              { num: 10, name: "Liam W.", pos: "BN", active: false },
              { num: 11, name: "Ethan G.", pos: "BN", active: false },
              { num: 12, name: "Jackson D.", pos: "BN", active: false },
            ].map((batter, i) => (
              <div 
                key={i} 
                className={`flex items-center h-10 rounded border bg-[#050d1a]
                  ${batter.active 
                    ? 'border-[#FFC107] bg-[#1a2a42] batter-row-active z-10' 
                    : 'border-[#1a2a42]'}
                `}
              >
                <div className={`w-8 h-full flex items-center justify-center font-['Roboto_Mono'] font-bold text-xs shrink-0 rounded-l
                  ${batter.active ? 'bg-[#FFC107] text-black' : 'bg-[#1a2a42] text-gray-400'}
                `}>
                  {batter.num}
                </div>
                <div className="flex-1 flex items-center justify-between px-2 overflow-hidden">
                  <div className={`font-bold text-sm truncate ${batter.active ? 'text-white' : 'text-gray-200'}`}>
                    {batter.name}
                  </div>
                  <div className={`font-['Roboto_Mono'] text-[10px] font-bold ml-1 shrink-0
                    ${batter.pos === 'BN' ? 'text-gray-500' : (batter.active ? 'text-[#FFC107]' : 'text-gray-400')}
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

import React, { useState } from "react";
import { ChevronUp, ChevronDown, X, Users, Menu, Map } from "lucide-react";

export function PortraitTabs() {
  const [activeTab, setActiveTab] = useState<"field" | "bench" | "order">("field");
  const [showBenchPeek, setShowBenchPeek] = useState(false);

  const fieldPlayers = [
    { pos: "C", name: "Diego R.", x: "50%", y: "85%" },
    { pos: "P", name: "Marcus J.", x: "50%", y: "55%" },
    { pos: "1B", name: "Tyler K.", x: "85%", y: "45%" },
    { pos: "2B", name: "Aiden P.", x: "65%", y: "25%" },
    { pos: "SS", name: "Noah L.", x: "35%", y: "25%" },
    { pos: "3B", name: "Hunter M.", x: "15%", y: "45%" },
    { pos: "LF", name: "Mason B.", x: "20%", y: "8%" },
    { pos: "CF", name: "Logan S.", x: "50%", y: "5%" },
    { pos: "RF", name: "Owen T.", x: "80%", y: "8%" },
  ];

  const benchPlayers = ["Liam W.", "Ethan G.", "Jackson D."];

  const lineup = [
    { num: 1, name: "Noah L.", pos: "SS" },
    { num: 2, name: "Marcus J.", pos: "P" },
    { num: 3, name: "Diego R.", pos: "C" },
    { num: 4, name: "Tyler K.", pos: "1B" },
    { num: 5, name: "Hunter M.", pos: "3B" },
    { num: 6, name: "Aiden P.", pos: "2B" },
    { num: 7, name: "Mason B.", pos: "LF" },
    { num: 8, name: "Logan S.", pos: "CF" },
    { num: 9, name: "Owen T.", pos: "RF" },
    { num: 10, name: "Liam W.", pos: "BENCH" },
    { num: 11, name: "Ethan G.", pos: "BENCH" },
    { num: 12, name: "Jackson D.", pos: "BENCH" },
  ];

  return (
    <div className="w-[390px] h-[844px] bg-[#000000] text-white flex flex-col font-['Oswald'] overflow-hidden relative mx-auto my-8 outline outline-4 outline-slate-800 rounded-[40px] shadow-2xl">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Roboto+Mono:wght@500;700&display=swap');
        
        .broadcast-panel {
          background: linear-gradient(135deg, #0A192F 0%, #050d1a 100%);
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
          background: #022010;
          background-image: 
            repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(255,255,255,0.02) 40px, rgba(255,255,255,0.02) 80px);
        }

        .basepath {
          border: 2px solid rgba(255,255,255,0.8);
          transform: rotate(45deg);
        }

        /* Hide scrollbar */
        ::-webkit-scrollbar {
          width: 0px;
          background: transparent;
        }
      `}} />

      {/* Header - Fixed ~120px */}
      <div className="h-[120px] w-full flex flex-col bg-[#0A192F] border-b-4 border-[#FFC107] shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-20 shrink-0 pt-10 pb-2 px-4">
        
        {/* Top Strip: Exit + Matchup */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-widest text-white">TIGERS <span className="text-gray-500 mx-1">vs</span> <span className="accent-gold">WILDCATS</span></h1>
          </div>
          <button className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Bottom Strip: Scores + Inning */}
        <div className="flex items-center justify-between">
          {/* Away Score */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-1">
              <button className="w-8 h-6 bg-white/5 rounded flex items-center justify-center text-gray-400 hover:bg-white/10"><ChevronUp size={16}/></button>
              <button className="w-8 h-6 bg-white/5 rounded flex items-center justify-center text-gray-400 hover:bg-white/10"><ChevronDown size={16}/></button>
            </div>
            <div className="text-4xl font-bold font-['Roboto_Mono'] w-10 text-center">2</div>
          </div>

          {/* Inning Chip */}
          <div className="flex flex-col items-center bg-[#050d1a] border border-[#1a2a42] rounded-lg px-4 py-1">
            <div className="text-[10px] text-gray-400 uppercase tracking-widest leading-none mb-1">Inning</div>
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5">
                <button className="text-gray-500 hover:text-[#FFC107]"><ChevronUp size={14}/></button>
                <button className="text-[#FFC107]"><ChevronDown size={14}/></button>
              </div>
              <span className="font-['Roboto_Mono'] text-2xl font-bold text-white leading-none">3RD</span>
            </div>
          </div>

          {/* Home Score */}
          <div className="flex items-center gap-2">
            <div className="text-4xl font-bold font-['Roboto_Mono'] w-10 text-center accent-gold">4</div>
            <div className="flex flex-col gap-1">
              <button className="w-8 h-6 bg-white/5 rounded flex items-center justify-center text-gray-400 hover:bg-white/10"><ChevronUp size={16}/></button>
              <button className="w-8 h-6 bg-white/5 rounded flex items-center justify-center text-gray-400 hover:bg-white/10"><ChevronDown size={16}/></button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative overflow-hidden bg-[#03060a]">
        
        {/* FIELD TAB */}
        {activeTab === "field" && (
          <div className="absolute inset-0 flex flex-col">
            <div className="flex-1 field-grass relative overflow-hidden flex items-center justify-center">
              
              {/* Baseball Diamond */}
              <div className="absolute w-[280px] h-[280px] basepath bottom-[20%] left-1/2 -ml-[140px]" />
              <div className="absolute w-[50px] h-[50px] bg-[rgba(255,255,255,0.1)] rounded-full bottom-[10%] left-1/2 -ml-[25px]" />
              <div className="absolute w-[40px] h-[40px] bg-[rgba(255,255,255,0.1)] rounded-full top-[40%] left-1/2 -ml-[20px]" />

              {/* Position Chips */}
              {fieldPlayers.map((p, i) => (
                <div 
                  key={i} 
                  className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2"
                  style={{ left: p.x, top: p.y }}
                >
                  <div className="bg-[#0A192F] border border-[#1a2a42] flex flex-col overflow-hidden rounded shadow-[0_4px_10px_rgba(0,0,0,0.8)] items-center">
                    <div className="bg-[#FFC107] text-black font-bold font-['Roboto_Mono'] w-full flex items-center justify-center text-sm py-0.5">
                      {p.pos}
                    </div>
                    <div className="px-2 py-1 font-bold text-sm whitespace-nowrap tracking-wide">
                      {p.name}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Floating Bench Pill */}
            <div className="absolute bottom-4 right-4 z-10">
              <button 
                onClick={() => setShowBenchPeek(!showBenchPeek)}
                className="bg-[#0A192F] border-2 border-[#1a2a42] text-white px-4 py-2 rounded-full font-bold shadow-xl flex items-center gap-2 hover:border-[#FFC107] transition-colors"
              >
                <Users size={16} className="text-[#FFC107]"/>
                <span>Bench (3)</span>
              </button>
            </div>

            {/* Bench Peek Sheet */}
            {showBenchPeek && (
              <div className="absolute bottom-0 left-0 w-full bg-[#050d1a] border-t border-[#1a2a42] p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.8)] rounded-t-2xl z-20 animate-in slide-in-from-bottom-full duration-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-lg text-gray-300 uppercase tracking-widest">Bench Players</h3>
                  <button onClick={() => setShowBenchPeek(false)} className="p-2 text-gray-500 hover:text-white"><ChevronDown size={20}/></button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {benchPlayers.map((name, i) => (
                    <div key={i} className="flex-shrink-0 bg-[#0A192F] border border-[#1a2a42] rounded-lg p-3 w-32 flex flex-col items-center justify-center gap-2">
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-lg font-bold text-gray-400">
                        {name.charAt(0)}
                      </div>
                      <span className="font-bold text-sm whitespace-nowrap">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* BENCH TAB */}
        {activeTab === "bench" && (
          <div className="absolute inset-0 flex flex-col broadcast-panel">
            <div className="bg-[#0A192F] border-b border-[#1a2a42] p-3">
              <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-2">In Field</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {fieldPlayers.map(p => (
                  <div key={p.pos} className="flex-shrink-0 bg-white/5 px-2 py-1 rounded flex items-center gap-1 border border-white/10">
                    <span className="text-[#FFC107] font-['Roboto_Mono'] text-xs font-bold">{p.pos}</span>
                    <span className="text-xs font-bold text-gray-300">{p.name.split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <h2 className="text-xl font-bold tracking-widest uppercase mb-2">Available to Sub</h2>
              {benchPlayers.map((name, i) => (
                <div key={i} className="bg-[#0A192F] border border-[#1a2a42] rounded-xl p-4 flex items-center justify-between shadow-lg">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-xl font-bold text-gray-400 border border-white/10">
                      {name.charAt(0)}
                    </div>
                    <span className="font-bold text-2xl">{name}</span>
                  </div>
                  <button className="bg-white/10 hover:bg-[#FFC107] hover:text-black text-white px-4 py-2 rounded font-bold transition-colors">
                    SUB IN
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ORDER TAB */}
        {activeTab === "order" && (
          <div className="absolute inset-0 flex flex-col broadcast-panel">
            <div className="bg-[#0A192F] border-b border-[#1a2a42] p-4 text-center sticky top-0 z-10 shadow-md">
              <h2 className="text-2xl font-bold tracking-widest uppercase text-white">Batting Order</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {lineup.map((batter, i) => (
                <div 
                  key={i} 
                  className="flex items-stretch h-[64px] mb-1 rounded overflow-hidden stripe-row border border-transparent"
                >
                  <div className="w-14 flex items-center justify-center font-['Roboto_Mono'] font-bold text-2xl bg-[rgba(255,255,255,0.05)] text-[#FFC107] border-r border-white/5">
                    {batter.num}
                  </div>
                  <div className="flex-1 flex items-center justify-between px-4">
                    <div className="font-bold text-2xl tracking-wide text-white">
                      {batter.name}
                    </div>
                    <div className={`font-['Roboto_Mono'] text-lg font-bold px-2 py-1 rounded bg-white/5 
                      ${batter.pos === 'BENCH' ? 'text-gray-500' : 'text-[#FFC107]'}
                    `}>
                      {batter.pos}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Bottom Tab Bar - ~64px */}
      <div className="h-[72px] bg-[#050d1a] border-t border-[#1a2a42] flex shrink-0 pb-safe relative z-20">
        <button 
          onClick={() => setActiveTab("field")}
          className={`flex-1 flex flex-col items-center justify-center gap-1 border-t-2 transition-colors ${activeTab === 'field' ? 'border-[#FFC107] text-white bg-white/5' : 'border-transparent text-slate-500'}`}
        >
          <Map size={24} className={activeTab === 'field' ? 'text-[#FFC107]' : ''} />
          <span className="text-xs font-bold uppercase tracking-wider">Field</span>
        </button>
        <button 
          onClick={() => setActiveTab("bench")}
          className={`flex-1 flex flex-col items-center justify-center gap-1 border-t-2 transition-colors ${activeTab === 'bench' ? 'border-[#FFC107] text-white bg-white/5' : 'border-transparent text-slate-500'}`}
        >
          <Users size={24} className={activeTab === 'bench' ? 'text-[#FFC107]' : ''} />
          <span className="text-xs font-bold uppercase tracking-wider">Bench</span>
        </button>
        <button 
          onClick={() => setActiveTab("order")}
          className={`flex-1 flex flex-col items-center justify-center gap-1 border-t-2 transition-colors ${activeTab === 'order' ? 'border-[#FFC107] text-white bg-white/5' : 'border-transparent text-slate-500'}`}
        >
          <Menu size={24} className={activeTab === 'order' ? 'text-[#FFC107]' : ''} />
          <span className="text-xs font-bold uppercase tracking-wider">Order</span>
        </button>
      </div>
    </div>
  );
}

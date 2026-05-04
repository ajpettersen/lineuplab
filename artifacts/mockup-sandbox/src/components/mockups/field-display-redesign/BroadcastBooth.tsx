import React from "react";

export function BroadcastBooth() {
  return (
    <div className="w-full h-full min-h-[900px] bg-[#000000] text-white flex flex-col font-['Oswald'] overflow-hidden">
      <style dangerouslySetInnerHTML={{__html: `
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
          background: #022010;
          background-image: 
            repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(255,255,255,0.02) 40px, rgba(255,255,255,0.02) 80px);
        }

        .basepath {
          border: 2px solid rgba(255,255,255,0.8);
          transform: rotate(45deg);
        }
      `}} />

      {/* Header */}
      <div className="h-[80px] w-full flex bg-[#0A192F] border-b-4 border-[#FFC107] shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-10 relative">
        <div className="flex-1 flex items-center justify-start px-8">
          <div className="flex items-center gap-4">
            <div className="text-5xl font-bold tracking-wider">TIGERS</div>
            <div className="text-2xl text-gray-400 font-bold px-2">2</div>
          </div>
          <div className="mx-6 text-gray-500 font-bold text-2xl">vs</div>
          <div className="flex items-center gap-4">
            <div className="text-2xl accent-gold font-bold px-2">4</div>
            <div className="text-5xl font-bold tracking-wider accent-gold">WILDCATS</div>
          </div>
        </div>

        <div className="flex items-center justify-center bg-[#050d1a] px-10 border-l border-r border-[#1a2a42]">
          <div className="flex flex-col items-center">
            <div className="text-sm text-gray-400 uppercase tracking-widest">Inning</div>
            <div className="flex items-center gap-2">
              <span className="text-[#FFC107] text-2xl leading-none">▲</span>
              <span className="font-['Roboto_Mono'] text-3xl font-bold">3RD</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-end px-8">
          <div className="flex flex-col items-end">
            <div className="text-sm text-gray-400 uppercase tracking-widest">Elapsed Time</div>
            <div className="font-['Roboto_Mono'] text-3xl font-bold tracking-wider">00:42</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Field */}
        <div className="flex-[0.7] flex flex-col p-6 bg-[#03060a]">
          <div className="flex-1 rounded-xl field-grass border-2 border-[#1a2a42] relative overflow-hidden flex items-center justify-center shadow-inner">
            
            {/* Baseball Diamond Abstraction */}
            <div className="absolute w-[400px] h-[400px] basepath bottom-10 left-1/2 -ml-[200px]" />
            <div className="absolute w-[80px] h-[80px] bg-[rgba(255,255,255,0.1)] rounded-full bottom-[-30px] left-1/2 -ml-[40px]" />
            <div className="absolute w-[60px] h-[60px] bg-[rgba(255,255,255,0.1)] rounded-full top-[170px] left-1/2 -ml-[30px]" />

            {/* Position Chips */}
            {[
              { pos: "C", name: "Diego R.", x: "50%", y: "90%" },
              { pos: "P", name: "Marcus J.", x: "50%", y: "65%" },
              { pos: "1B", name: "Tyler K.", x: "75%", y: "55%" },
              { pos: "2B", name: "Aiden P.", x: "65%", y: "35%" },
              { pos: "SS", name: "Noah L.", x: "35%", y: "35%" },
              { pos: "3B", name: "Hunter M.", x: "25%", y: "55%" },
              { pos: "LF", name: "Mason B.", x: "20%", y: "15%" },
              { pos: "CF", name: "Logan S.", x: "50%", y: "10%" },
              { pos: "RF", name: "Owen T.", x: "80%", y: "15%" },
            ].map((p, i) => (
              <div 
                key={i} 
                className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 shadow-lg"
                style={{ left: p.x, top: p.y }}
              >
                <div className="bg-[#0A192F] border border-[#1a2a42] flex overflow-hidden rounded shadow-[0_4px_10px_rgba(0,0,0,0.8)]">
                  <div className="bg-[#FFC107] text-black font-bold font-['Roboto_Mono'] w-10 flex items-center justify-center text-lg">
                    {p.pos}
                  </div>
                  <div className="px-3 py-1 font-bold text-lg whitespace-nowrap tracking-wide">
                    {p.name}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Bench Strip */}
          <div className="h-[80px] mt-6 flex items-center bg-[#050d1a] border border-[#1a2a42] rounded-xl px-6">
            <div className="text-gray-400 uppercase tracking-widest font-bold mr-6">Bench</div>
            <div className="flex gap-4">
              {["Liam W.", "Ethan G.", "Jackson D."].map((name, i) => (
                <div key={i} className="px-4 py-2 bg-[#0A192F] border border-[#1a2a42] rounded font-bold text-lg text-gray-300">
                  {name}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Batting Order */}
        <div className="flex-[0.3] broadcast-panel flex flex-col border-l-0 relative z-20 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
          <div className="bg-[#0A192F] border-b-2 border-[#1a2a42] p-4 text-center">
            <h2 className="text-3xl font-bold tracking-widest uppercase accent-gold">Lineup</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
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
              { num: 10, name: "Liam W.", pos: "BENCH", active: false },
              { num: 11, name: "Ethan G.", pos: "BENCH", active: false },
              { num: 12, name: "Jackson D.", pos: "BENCH", active: false },
            ].map((batter, i) => (
              <div 
                key={i} 
                className={`flex items-stretch h-[56px] mb-1 rounded overflow-hidden stripe-row transition-all
                  ${batter.active ? 'bg-[#1a2a42] border border-[#FFC107] shadow-lg transform scale-[1.02]' : 'border border-transparent'}
                `}
              >
                <div className={`w-12 flex items-center justify-center font-['Roboto_Mono'] font-bold text-xl
                  ${batter.active ? 'bg-[#FFC107] text-black' : 'bg-[rgba(255,255,255,0.05)] text-gray-400'}
                `}>
                  {batter.num}
                </div>
                <div className="flex-1 flex items-center justify-between px-4">
                  <div className={`font-bold text-2xl tracking-wide ${batter.active ? 'text-white' : 'text-gray-200'}`}>
                    {batter.name}
                  </div>
                  <div className={`font-['Roboto_Mono'] text-lg font-bold 
                    ${batter.pos === 'BENCH' ? 'text-gray-500' : (batter.active ? 'text-[#FFC107]' : 'text-gray-400')}
                  `}>
                    {batter.pos}
                  </div>
                </div>
                {batter.active && (
                  <div className="w-12 flex items-center justify-center bg-[rgba(255,193,7,0.1)]">
                    <span className="text-[#FFC107] font-['Roboto_Mono'] font-bold">AB</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

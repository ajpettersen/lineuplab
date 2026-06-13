import React from "react";
import "../_group.css";

export type FieldDisplayMode = "league" | "pool" | "bracket" | "champ" | "champ-elevated";

export function FieldStage({ mode }: { mode: FieldDisplayMode }) {
  // Mode-specific configurations
  const config = {
    bannerText: mode === "pool" ? "POOL PLAY · DAY 2" : 
                mode === "bracket" ? "WIN OR GO HOME · QUARTERFINALS" : 
                (mode === "champ" || mode === "champ-elevated") ? "🏆 CHAMPIONSHIP FINAL 🏆" : null,
    
    bannerBg: mode === "pool" ? "bg-[#111]" : 
              mode === "bracket" ? "bg-[var(--team-primary)] text-white" : 
              "bg-gradient-to-r from-[var(--team-primary-dark)] via-[var(--team-primary)] to-[var(--team-primary-dark)] text-white shadow-[0_0_15px_rgba(192,31,46,0.5)]",
              
    headerBorder: mode === "league" ? "border-[var(--team-secondary-dark)]" :
                  mode === "pool" ? "border-[var(--team-primary)]" :
                  mode === "bracket" ? "border-[var(--team-primary)]" :
                  mode === "champ" ? "border-[var(--team-primary)] fdm-gold-border" :
                  "border-[var(--trophy-gold)] shadow-[0_0_20px_rgba(255,193,7,0.3)]",
                  
    primaryColorClass: mode === "league" ? "text-white" :
                       mode === "pool" ? "text-[var(--team-primary)]" :
                       mode === "bracket" ? "text-[var(--team-primary)] drop-shadow-md" :
                       mode === "champ" ? "text-[var(--team-primary)] drop-shadow-lg" :
                       "fdm-champ-text-shimmer drop-shadow-[0_0_14px_rgba(192,31,46,0.7)]",
                       
    activeBatterBg: mode === "league" ? "bg-[#1a2a42]" :
                    mode === "pool" ? "bg-[#1a2a42] border-[var(--team-primary)]" :
                    mode === "bracket" ? "bg-[#1a2a42] border-[var(--team-primary)] shadow-[0_0_10px_rgba(192,31,46,0.3)]" :
                    mode === "champ" ? "bg-[#1a2a42] border-[var(--trophy-gold)] shadow-[0_0_10px_rgba(255,193,7,0.2)]" :
                    "bg-[#1a2a42] border-[var(--trophy-gold)] shadow-[0_0_20px_rgba(255,193,7,0.4)]",
                    
    activeBatterChip: mode === "league" ? "bg-[var(--team-secondary)] text-black" :
                      mode === "pool" ? "bg-[var(--team-primary)] text-white" :
                      mode === "bracket" ? "bg-[var(--team-primary)] text-white fdm-bracket-pulse" :
                      mode === "champ" ? "bg-[var(--team-primary)] text-white border border-[var(--trophy-gold)]" :
                      "fdm-champ-shimmer text-white border border-[var(--trophy-gold)]",
                      
    chipBg: mode === "league" ? "bg-[var(--team-secondary)] text-black" :
            mode === "pool" ? "bg-[var(--team-primary)] text-white" :
            mode === "bracket" ? "bg-[var(--team-primary)] text-white" :
            mode === "champ" ? "bg-[var(--team-primary)] text-white border-b-2 border-[var(--trophy-gold)]" :
            "bg-[var(--team-primary)] text-white border border-[var(--trophy-gold)] shadow-[0_0_10px_rgba(255,193,7,0.5)]",
            
    fieldClass: mode === "champ-elevated" ? "fdm-champ-elevated-field" : "fdm-field-grass border-2 border-[#1a2a42]"
  };

  const players = [
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

  const fielders = [
    { pos: "C", name: "Diego R.", x: "50%", y: "90%" },
    { pos: "P", name: "Marcus J.", x: "50%", y: "65%" },
    { pos: "1B", name: "Tyler K.", x: "75%", y: "55%" },
    { pos: "2B", name: "Aiden P.", x: "65%", y: "35%" },
    { pos: "SS", name: "Noah L.", x: "35%", y: "35%" },
    { pos: "3B", name: "Hunter M.", x: "25%", y: "55%" },
    { pos: "LF", name: "Mason B.", x: "20%", y: "15%" },
    { pos: "CF", name: "Logan S.", x: "50%", y: "10%" },
    { pos: "RF", name: "Owen T.", x: "80%", y: "15%" },
  ];

  return (
    <div className="w-full h-full min-h-[900px] fdm-container flex flex-col overflow-hidden relative">
      {/* Background confetti/particles for champ-elevated */}
      {mode === "champ-elevated" && (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden opacity-30">
          {Array.from({ length: 20 }).map((_, i) => (
            <div 
              key={i}
              className="absolute w-2 h-2 bg-[var(--trophy-gold)] rounded-full"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animation: `float-confetti ${3 + Math.random() * 4}s linear infinite`,
                animationDelay: `-${Math.random() * 5}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Banner */}
      {config.bannerText && (
        <div className={`h-[32px] w-full flex items-center justify-center text-sm font-bold tracking-[0.2em] ${config.bannerBg} z-20 transition-all`}>
          {config.bannerText}
        </div>
      )}

      {/* Header Scorebug */}
      <div className={`h-[80px] w-full flex bg-[#0a1018] border-b-4 ${config.headerBorder} shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-10 relative transition-all`}>
        <div className="flex-1 flex items-center justify-start px-8 gap-4 min-w-0">
          <div className="text-5xl font-bold tracking-wider text-gray-300 whitespace-nowrap">NORTHGATE</div>
          <div className="fdm-mono text-3xl text-gray-500 font-bold">2</div>
        </div>

        <div className="flex items-center justify-center bg-[var(--bg-stadium)] px-8 border-l border-r border-[#1a2a42] gap-8 shrink-0">
          <div className="flex flex-col items-center">
            <div className="text-xs text-gray-400 uppercase tracking-widest">Inning</div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--team-primary)] text-xl leading-none">▲</span>
              <span className="fdm-mono text-2xl font-bold">3RD</span>
            </div>
          </div>
          <div className="flex flex-col items-center">
            <div className="text-xs text-gray-400 uppercase tracking-widest">Time</div>
            <div className="fdm-mono text-2xl font-bold tracking-wider">00:42</div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-end px-8 gap-4 min-w-0">
          {(mode === "champ" || mode === "champ-elevated") && (
             <div className="text-[var(--trophy-gold)] text-3xl drop-shadow-[0_0_8px_rgba(255,193,7,0.8)]">★</div>
          )}
          <div className={`fdm-mono text-3xl font-bold ${config.primaryColorClass}`}>4</div>
          <div className={`text-5xl font-bold tracking-wider whitespace-nowrap ${config.primaryColorClass}`}>RIVER CITY</div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden z-10">
        {/* Left Side: Field & Bench */}
        <div className="flex-[0.7] flex flex-col p-6 bg-[#03060a]">
          <div className={`flex-1 rounded-xl relative overflow-hidden flex items-center justify-center shadow-inner transition-all duration-700 ${config.fieldClass}`}>
            
            {/* Baseball Diamond Abstraction */}
            <div className="absolute w-[400px] h-[400px] fdm-basepath bottom-10 left-1/2 -ml-[200px]" />
            <div className="absolute w-[80px] h-[80px] bg-[rgba(255,255,255,0.05)] rounded-full bottom-[-30px] left-1/2 -ml-[40px]" />
            <div className="absolute w-[60px] h-[60px] bg-[rgba(255,255,255,0.05)] rounded-full top-[170px] left-1/2 -ml-[30px]" />

            {/* Position Chips */}
            {fielders.map((p, i) => (
              <div 
                key={i} 
                className="absolute flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2 shadow-lg transition-transform duration-300 hover:scale-110"
                style={{ left: p.x, top: p.y }}
              >
                <div className="bg-[#0a1018] border border-[#1a2a42] flex overflow-hidden rounded shadow-[0_4px_10px_rgba(0,0,0,0.8)]">
                  <div className={`fdm-mono w-10 flex items-center justify-center text-lg font-bold transition-colors ${config.chipBg}`}>
                    {p.pos}
                  </div>
                  <div className="px-3 py-1 font-bold text-lg whitespace-nowrap tracking-wide text-gray-200">
                    {p.name}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Bench Strip */}
          <div className="h-[80px] mt-6 flex items-center bg-[#0a1018] border border-[#1a2a42] rounded-xl px-6 relative overflow-hidden">
            {mode === "champ-elevated" && (
              <div className="absolute inset-0 bg-gradient-to-r from-[rgba(192,31,46,0.1)] to-transparent pointer-events-none" />
            )}
            <div className="text-gray-500 uppercase tracking-widest font-bold mr-6 z-10">Bench</div>
            <div className="flex gap-4 z-10">
              {players.filter(p => p.pos === "BENCH").map((p, i) => (
                <div key={i} className="px-4 py-2 bg-[#121a28] border border-[#1a2a42] rounded font-bold text-lg text-gray-400">
                  {p.name}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Batting Order */}
        <div className="flex-[0.3] fdm-panel flex flex-col border-l-0 relative z-20 shadow-[-10px_0_30px_rgba(0,0,0,0.6)]">
          <div className="bg-[#0a1018] border-b-2 border-[#1a2a42] p-4 text-center relative overflow-hidden">
            {mode === "champ-elevated" && (
               <div className="absolute inset-0 bg-gradient-to-b from-[rgba(255,193,7,0.1)] to-transparent" />
            )}
            <h2 className={`text-3xl font-bold tracking-widest uppercase transition-colors ${(mode === "champ" || mode === "champ-elevated") ? "fdm-gold-accent" : "text-[var(--team-secondary)]"}`}>
              Lineup
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
            {players.map((batter, i) => (
              <div 
                key={i} 
                className={`flex items-stretch h-[56px] mb-1 rounded overflow-hidden fdm-stripe-row transition-all duration-300
                  ${batter.active ? config.activeBatterBg + ' transform scale-[1.02]' : 'border border-transparent'}
                `}
              >
                <div className={`w-12 flex items-center justify-center fdm-mono font-bold text-xl transition-colors
                  ${batter.active ? config.activeBatterChip : 'bg-[rgba(255,255,255,0.03)] text-gray-500'}
                `}>
                  {batter.num}
                </div>
                <div className="flex-1 flex items-center justify-between px-4">
                  <div className={`font-bold text-2xl tracking-wide ${batter.active ? 'text-white drop-shadow-md' : 'text-gray-300'}`}>
                    {batter.name}
                  </div>
                  <div className={`fdm-mono text-lg font-bold transition-colors
                    ${batter.pos === 'BENCH' ? 'text-gray-600' : (batter.active ? 'text-[var(--team-secondary)]' : 'text-gray-500')}
                  `}>
                    {batter.pos}
                  </div>
                </div>
                {batter.active && (
                  <div className="w-12 flex items-center justify-center bg-[rgba(192,31,46,0.1)] border-l border-[rgba(255,255,255,0.05)]">
                    <span className="text-[var(--team-primary)] fdm-mono font-bold">AB</span>
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

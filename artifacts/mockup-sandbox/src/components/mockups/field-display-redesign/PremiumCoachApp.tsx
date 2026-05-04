import React from "react";
import { Badge } from "@/components/ui/badge";

export function PremiumCoachApp() {
  return (
    <div className="w-full h-screen max-h-[900px] overflow-hidden flex flex-col text-slate-100 font-sans" style={{ backgroundColor: "#0B1021" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        
        .font-geist {
          font-family: 'Geist', sans-serif;
        }
        
        .glass-panel {
          background: rgba(20, 26, 48, 0.6);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
        }
        
        .grass-gradient {
          background: radial-gradient(circle at 50% 20%, #1A3626 0%, #0F2016 80%);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .basepath {
          border: 2px solid rgba(200, 180, 140, 0.2);
          box-shadow: 0 0 15px rgba(200, 180, 140, 0.1);
        }
        
        .player-chip {
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }
        
        .batting-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: all 0.2s ease;
        }
        
        .batting-card.active {
          background: rgba(245, 158, 11, 0.1);
          border-color: rgba(245, 158, 11, 0.3);
          box-shadow: 0 0 20px rgba(245, 158, 11, 0.15);
          transform: scale(1.02);
        }
        
        .slot-circle {
          background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.02));
          border: 1px solid rgba(255,255,255,0.1);
        }
      ` }} />

      {/* Header */}
      <header className="h-24 shrink-0 glass-panel border-x-0 border-t-0 border-b border-white/10 flex items-center justify-between px-8 relative z-10">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-xs font-semibold tracking-widest text-slate-400 uppercase">Home</span>
            <span className="text-xl font-bold tracking-tight text-white">WILDCATS</span>
          </div>
          <div className="w-px h-10 bg-white/10"></div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold tracking-widest text-slate-400 uppercase">Away</span>
            <span className="text-xl font-medium tracking-tight text-slate-300">TIGERS</span>
          </div>
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-12">
          <div className="text-right">
            <div className="text-4xl font-geist font-bold tabular-nums text-white">4</div>
          </div>
          <div className="flex flex-col items-center justify-center pt-1">
            <Badge variant="outline" className="bg-white/5 border-white/10 text-slate-300 tracking-widest text-[10px] mb-1 px-3 py-0.5 rounded-full">
              TOP 3RD
            </Badge>
            <span className="text-xs font-medium text-slate-400">00:42 elapsed</span>
          </div>
          <div className="text-left">
            <div className="text-4xl font-geist font-medium tabular-nums text-slate-400">2</div>
          </div>
        </div>

        <div className="flex items-center">
          <div className="px-4 py-2 rounded-full glass-panel flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-xs font-medium tracking-wide text-slate-200">LIVE</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden p-6 gap-6">
        
        {/* Left: Field + Bench */}
        <div className="flex-[7] flex flex-col min-w-0 gap-6">
          
          {/* Field Area */}
          <div className="flex-1 relative grass-gradient rounded-3xl overflow-hidden flex items-center justify-center shadow-2xl">
            {/* Field Graphics */}
            <div className="absolute inset-0 opacity-20 pointer-events-none">
              <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                {/* Outfield arc */}
                <path d="M 10 50 Q 50 10 90 50" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.2" strokeDasharray="1, 1"/>
                {/* Infield dirt arc */}
                <path d="M 30 70 Q 50 45 70 70" fill="none" stroke="rgba(200, 180, 140, 0.5)" strokeWidth="2" />
                {/* Lines */}
                <line x1="50" y1="90" x2="10" y2="50" stroke="rgba(255,255,255,0.8)" strokeWidth="0.3" />
                <line x1="50" y1="90" x2="90" y2="50" stroke="rgba(255,255,255,0.8)" strokeWidth="0.3" />
              </svg>
            </div>
            
            <div className="relative w-[500px] h-[500px] mt-20">
              {/* Diamond */}
              <div className="absolute top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[240px] h-[240px] rotate-45 basepath rounded-xl"></div>
              
              {/* Bases */}
              <div className="absolute bottom-[5%] left-1/2 -translate-x-1/2 translate-y-1/2 w-6 h-6 bg-white rounded-sm shadow-[0_0_10px_rgba(255,255,255,0.5)] rotate-45"></div> {/* Home */}
              <div className="absolute top-[45%] right-[-5%] translate-x-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-sm shadow-[0_0_10px_rgba(255,255,255,0.5)] rotate-45"></div> {/* 1B */}
              <div className="absolute top-[-5%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-sm shadow-[0_0_10px_rgba(255,255,255,0.5)] rotate-45"></div> {/* 2B */}
              <div className="absolute top-[45%] left-[-5%] -translate-x-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-sm shadow-[0_0_10px_rgba(255,255,255,0.5)] rotate-45"></div> {/* 3B */}
              
              <div className="absolute top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full border-2 border-[rgba(200,180,140,0.3)] bg-[rgba(200,180,140,0.1)] flex items-center justify-center">
                <div className="w-6 h-2 bg-white/80 rounded-full"></div> {/* Pitcher plate */}
              </div>

              {/* Players */}
              <PlayerChip pos="P" name="Marcus J." style={{ top: '45%', left: '50%', transform: 'translate(-50%, -120%)' }} />
              <PlayerChip pos="C" name="Diego R." style={{ bottom: '-5%', left: '50%', transform: 'translate(-50%, 100%)' }} />
              <PlayerChip pos="1B" name="Tyler K." style={{ top: '40%', right: '5%', transform: 'translate(20%, -50%)' }} />
              <PlayerChip pos="2B" name="Aiden P." style={{ top: '15%', right: '20%', transform: 'translate(50%, -50%)' }} />
              <PlayerChip pos="3B" name="Hunter M." style={{ top: '40%', left: '5%', transform: 'translate(-20%, -50%)' }} />
              <PlayerChip pos="SS" name="Noah L." style={{ top: '15%', left: '20%', transform: 'translate(-50%, -50%)' }} />
              <PlayerChip pos="LF" name="Mason B." style={{ top: '-15%', left: '-5%', transform: 'translate(-50%, -50%)' }} />
              <PlayerChip pos="CF" name="Logan S." style={{ top: '-25%', left: '50%', transform: 'translate(-50%, -50%)' }} />
              <PlayerChip pos="RF" name="Owen T." style={{ top: '-15%', right: '-5%', transform: 'translate(50%, -50%)' }} />
            </div>
          </div>

          {/* Bench Strip */}
          <div className="h-20 shrink-0 glass-panel rounded-2xl flex items-center px-6 gap-4">
            <span className="text-xs font-semibold tracking-widest text-slate-500 uppercase mr-2">Bench</span>
            
            <BenchChip name="Liam W." />
            <BenchChip name="Ethan G." />
            <BenchChip name="Jackson D." />
          </div>

        </div>

        {/* Right: Batting Order */}
        <div className="flex-[3] min-w-[320px] max-w-[400px] glass-panel rounded-3xl flex flex-col overflow-hidden">
          <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
            <h2 className="text-sm font-semibold tracking-widest text-slate-300 uppercase">Batting Order</h2>
            <span className="text-xs font-medium text-slate-500">12 Batters</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
            {[
              { id: 1, name: "Noah L.", pos: "SS", active: true },
              { id: 2, name: "Marcus J.", pos: "P" },
              { id: 3, name: "Diego R.", pos: "C" },
              { id: 4, name: "Tyler K.", pos: "1B" },
              { id: 5, name: "Hunter M.", pos: "3B" },
              { id: 6, name: "Aiden P.", pos: "2B" },
              { id: 7, name: "Mason B.", pos: "LF" },
              { id: 8, name: "Logan S.", pos: "CF" },
              { id: 9, name: "Owen T.", pos: "RF" },
              { id: 10, name: "Liam W.", pos: "BENCH" },
              { id: 11, name: "Ethan G.", pos: "BENCH" },
              { id: 12, name: "Jackson D.", pos: "BENCH" }
            ].map((batter) => (
              <div 
                key={batter.id} 
                className={`batting-card rounded-xl p-3 flex items-center gap-4 ${batter.active ? 'active' : ''}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold font-geist ${batter.active ? 'bg-amber-500/20 text-amber-400' : 'slot-circle text-slate-400'}`}>
                  {batter.id}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${batter.active ? 'text-amber-50' : 'text-slate-200'}`}>
                    {batter.name}
                  </div>
                </div>
                <div className={`text-[10px] font-bold tracking-wider px-2 py-1 rounded bg-white/5 ${batter.pos === 'BENCH' ? 'text-slate-500' : 'text-slate-400'}`}>
                  {batter.pos}
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}

function PlayerChip({ pos, name, style }: { pos: string, name: string, style?: React.CSSProperties }) {
  return (
    <div className="absolute player-chip rounded-xl p-1.5 min-w-[80px] flex flex-col items-center justify-center z-10 hover:scale-105 transition-transform cursor-default" style={style}>
      <span className="text-[9px] font-bold tracking-widest text-emerald-400/90 uppercase mb-0.5">{pos}</span>
      <span className="text-xs font-medium text-white whitespace-nowrap px-1">{name}</span>
    </div>
  );
}

function BenchChip({ name }: { name: string }) {
  const initials = name.split(' ').map(n => n[0]).join('');
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
      <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center text-xs font-medium text-slate-300">
        {initials}
      </div>
      <span className="text-sm font-medium text-slate-200">{name}</span>
    </div>
  );
}

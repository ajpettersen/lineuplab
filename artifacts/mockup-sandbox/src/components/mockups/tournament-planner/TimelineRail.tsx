import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Info, HelpCircle, AlertCircle, Plus, Calendar, Clock, MapPin, Shield } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

// Data Models & Constants
const TIMELINE_START = 0; // Sat 8:00 AM
const TIMELINE_END = 34; // Sun 6:00 PM (34 hours later)
const TIMELINE_DURATION = TIMELINE_END - TIMELINE_START;

const getLeftPercent = (hour: number) => `${((hour - TIMELINE_START) / TIMELINE_DURATION) * 100}%`;

const GAMES = [
  { id: "G1", title: "G1 vs Bombers", status: "completed", type: "Pool", hour: 0, length: 2 },
  { id: "G2", title: "G2 vs Storm", status: "completed", type: "Pool", hour: 6, length: 2 },
  { id: "G3", title: "G3 vs Eagles", status: "planned", type: "Quarterfinal", hour: 25, length: 2 },
  { id: "G4", title: "G4 vs TBD", status: "unplanned", type: "Semifinal", hour: 28, length: 2 },
  { id: "G5", title: "G5 Championship", status: "planned", type: "Championship", hour: 31, length: 2 },
];

const PITCHERS = [
  { id: "P1", num: 7, name: "Tommy Rivera", age: 12, role: "RHP / Ace", throws: "R" },
  { id: "P2", num: 12, name: "Jake Morales", age: 12, role: "RHP / Ace", throws: "R" },
  { id: "P3", num: 4, name: "Marco Silva", age: 11, role: "RHP / Mid", throws: "R" },
  { id: "P4", num: 22, name: "Lucas Park", age: 12, role: "LHP / Mid", throws: "L" },
  { id: "P5", num: 9, name: "Ethan Kim", age: 11, role: "LHP / Spec", throws: "L" },
  { id: "P6", num: 15, name: "Diego Alvarez", age: 12, role: "RHP / Mid", throws: "R" },
  { id: "P7", num: 3, name: "Caleb Walsh", age: 10, role: "RHP / Back", throws: "R" },
  { id: "P8", num: 18, name: "Owen Thomas", age: 11, role: "RHP / Back", throws: "R" },
];

const OUTINGS = [
  { pitcherId: "P1", gameId: "G1", pitches: 52, type: "actual" },
  { pitcherId: "P2", gameId: "G2", pitches: 38, type: "actual" },
  { pitcherId: "P3", gameId: "G1", pitches: 28, type: "actual" },
  { pitcherId: "P4", gameId: "G2", pitches: 22, type: "actual" },
  { pitcherId: "P5", gameId: "G3", pitches: 50, type: "planned" },
  { pitcherId: "P6", gameId: "G3", pitches: 40, type: "planned" },
  { pitcherId: "P7", gameId: "G5", pitches: 30, type: "planned" },
  { pitcherId: "P8", gameId: "G5", pitches: 30, type: "planned" },
];

const getColorForPitches = (pitches: number) => {
  if (pitches <= 25) return "bg-emerald-500 border-emerald-600";
  if (pitches <= 35) return "bg-yellow-400 border-yellow-500";
  if (pitches <= 50) return "bg-amber-500 border-amber-600";
  return "bg-rose-500 border-rose-600";
};

const getTextColorForPitches = (pitches: number) => {
  if (pitches <= 25) return "text-emerald-700";
  if (pitches <= 35) return "text-yellow-700";
  if (pitches <= 50) return "text-amber-700";
  return "text-rose-700";
};

const calculateRestHour = (startHour: number, pitches: number) => {
  // Rough approximation for timeline visualization
  // Sat 8am = hr 0, Sat 2pm = hr 6. Sun 12am = hr 16. Mon 12am = hr 40.
  if (pitches <= 25) return startHour + 2; // game duration
  if (pitches <= 35) return 16; // Sat midnight (start of Sun) -> hr 16
  if (pitches <= 50) return 40; // Sun midnight (start of Mon) -> hr 40
  if (pitches <= 65) return 64; // Mon midnight -> hr 64
  return 88; // hr 88
};

export function TimelineRail() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 flex flex-col font-sans">
      <header className="mb-6 bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">Memorial Day Madness</h1>
            <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100 uppercase tracking-wider font-bold text-xs">USSSA 12U</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500 font-medium">
            <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> May 25-26, 2026</span>
            <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> Cedar Park Sports Complex</span>
          </div>
        </div>
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="bg-white border-slate-300 text-slate-700 hover:bg-slate-50 shadow-sm">
              <Shield className="w-4 h-4 mr-2 text-slate-500" />
              USSSA Rest Rules
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4 text-sm shadow-xl border-slate-200" align="end">
            <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600" />
              12U Pitch Count Limits
            </h3>
            <ul className="space-y-2 text-slate-600 font-medium">
              <li className="flex justify-between items-center"><span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div>1–25 pitches</span> <span className="font-semibold text-slate-800">No rest</span></li>
              <li className="flex justify-between items-center"><span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-yellow-400"></div>26–35 pitches</span> <span className="font-semibold text-slate-800">1 day (same day)</span></li>
              <li className="flex justify-between items-center"><span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500"></div>36–50 pitches</span> <span className="font-semibold text-slate-800">1 calendar day</span></li>
              <li className="flex justify-between items-center"><span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-rose-500"></div>51–65 pitches</span> <span className="font-semibold text-slate-800">2 calendar days</span></li>
              <li className="flex justify-between items-center"><span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-800"></div>66+ pitches</span> <span className="font-semibold text-slate-800">3 calendar days</span></li>
            </ul>
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center font-bold text-slate-800">
              <span>Daily Max</span>
              <span>85 pitches</span>
            </div>
          </PopoverContent>
        </Popover>
      </header>

      <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        {/* Timeline Header Area */}
        <div className="flex border-b border-slate-200 bg-slate-50 sticky top-0 z-20">
          <div className="w-64 flex-shrink-0 border-r border-slate-200 p-4 flex items-end justify-between bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] z-30">
            <span className="font-semibold text-slate-700 uppercase tracking-wider text-xs">Pitcher Staff</span>
            <span className="text-xs font-medium text-slate-400">Available</span>
          </div>
          
          <div className="flex-1 relative min-w-[800px] h-20">
            {/* Hour Markers */}
            <div className="absolute top-0 bottom-0 left-0 right-0">
              {[0, 6, 12, 16, 24, 30, 34].map(hr => {
                let label = "";
                if (hr === 0) label = "Sat 8am";
                if (hr === 6) label = "2pm";
                if (hr === 12) label = "8pm";
                if (hr === 16) label = "Sun";
                if (hr === 24) label = "8am";
                if (hr === 30) label = "2pm";
                
                return (
                  <div key={hr} className="absolute top-0 bottom-0 border-l border-slate-200 border-dashed z-0" style={{ left: getLeftPercent(hr) }}>
                    {label && <span className="absolute -left-3 top-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-50 px-1">{label}</span>}
                  </div>
                )
              })}
            </div>

            {/* Games */}
            {GAMES.map(g => (
              <div 
                key={g.id} 
                className="absolute top-8 bottom-0 flex flex-col items-center justify-end pb-2 z-10 group"
                style={{ left: getLeftPercent(g.hour), width: getLeftPercent(TIMELINE_START + g.length) }}
              >
                <div className="absolute left-0 top-0 bottom-0 border-l-2 border-slate-300"></div>
                <div className={`
                  px-2 py-1 rounded text-xs font-bold whitespace-nowrap shadow-sm border -ml-1 transform -translate-x-1/2
                  ${g.status === 'completed' ? 'bg-slate-100 text-slate-600 border-slate-200' : 
                    g.status === 'planned' ? 'bg-blue-50 text-blue-700 border-blue-200' : 
                    'bg-white border-dashed border-amber-300 text-amber-700'}
                `}>
                  <div className="flex flex-col items-center">
                    <span>{g.title}</span>
                    <span className="text-[9px] uppercase tracking-wider opacity-80">{g.type}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline Rows */}
        <div className="flex-1 overflow-y-auto relative">
          {PITCHERS.map((p, i) => {
            const pitcherOutings = OUTINGS.filter(o => o.pitcherId === p.id);
            
            // Calc eligibility status simply for the left column badge
            const isFullyFresh = pitcherOutings.length === 0;
            const blockedOuting = pitcherOutings.find(o => calculateRestHour(GAMES.find(g=>g.id===o.gameId)!.hour, o.pitches) > 24 && o.type === 'actual');
            const isBlocked = !!blockedOuting;
            
            return (
              <div key={p.id} className={`flex border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                {/* Left Column: Pitcher Info */}
                <div className="w-64 flex-shrink-0 border-r border-slate-200 p-4 flex items-center justify-between bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] z-20">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-700 text-sm shadow-sm">
                      {p.num}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800 text-sm leading-tight">{p.name}</span>
                      <span className="text-xs text-slate-500 font-medium">{p.role}</span>
                    </div>
                  </div>
                  <div>
                    {isBlocked ? (
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] uppercase font-bold px-1.5 py-0">Blocked</Badge>
                    ) : isFullyFresh ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] uppercase font-bold px-1.5 py-0">Fresh</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200 text-[10px] uppercase font-bold px-1.5 py-0">Eligible</Badge>
                    )}
                  </div>
                </div>
                
                {/* Right Column: Timeline Row */}
                <div className="flex-1 relative min-w-[800px]">
                  {/* Grid Lines */}
                  {[0, 6, 12, 16, 24, 30, 34].map(hr => (
                    <div key={hr} className="absolute top-0 bottom-0 border-l border-slate-200 border-dashed z-0 pointer-events-none" style={{ left: getLeftPercent(hr) }}></div>
                  ))}

                  {/* Planned Game Drop Zones (Empty Slots) */}
                  {GAMES.filter(g => g.status !== 'completed').map(g => (
                    <div 
                      key={`slot-${g.id}`}
                      className="absolute top-1 bottom-1 border-x border-slate-100 bg-slate-50/30 z-0 pointer-events-none"
                      style={{ left: getLeftPercent(g.hour), width: getLeftPercent(TIMELINE_START + g.length) }}
                    ></div>
                  ))}

                  {/* TBD Assign Button for G4 */}
                  {GAMES.filter(g => g.status === 'unplanned').map(g => (
                    !pitcherOutings.find(o => o.gameId === g.id) && !isBlocked && (
                      <Popover key={`tbd-${p.id}-${g.id}`}>
                        <PopoverTrigger asChild>
                          <div 
                            className="absolute top-1/2 -translate-y-1/2 h-8 border border-dashed border-slate-300 rounded bg-white/50 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-all z-10 group"
                            style={{ left: getLeftPercent(g.hour), width: getLeftPercent(TIMELINE_START + g.length) }}
                          >
                            <Plus className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-3">
                          <h4 className="font-semibold text-sm mb-2">Assign to {g.title}</h4>
                          <div className="flex items-center gap-2 mb-3">
                            <input type="number" className="border rounded px-2 py-1 w-16 text-sm" placeholder="Pitches" defaultValue={30} />
                            <span className="text-xs text-slate-500">Planned pitches</span>
                          </div>
                          <Button size="sm" className="w-full">Confirm Assignment</Button>
                        </PopoverContent>
                      </Popover>
                    )
                  ))}

                  {/* Outings and Rest Regions */}
                  {pitcherOutings.map((o, idx) => {
                    const game = GAMES.find(g => g.id === o.gameId)!;
                    const restEndHr = Math.min(TIMELINE_END, calculateRestHour(game.hour, o.pitches));
                    const isActual = o.type === "actual";
                    
                    return (
                      <React.Fragment key={idx}>
                        {/* Rest Region */}
                        {isActual && restEndHr > game.hour + game.length && (
                          <div 
                            className="absolute top-2 bottom-2 bg-rose-50/80 border-y border-r border-rose-100 rounded-r z-0 overflow-hidden"
                            style={{ 
                              left: getLeftPercent(game.hour + game.length), 
                              width: `${((restEndHr - (game.hour + game.length)) / TIMELINE_DURATION) * 100}%` 
                            }}
                          >
                            <div className="w-full h-full opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #f43f5e 25%, transparent 25%, transparent 75%, #f43f5e 75%, #f43f5e), repeating-linear-gradient(45deg, #f43f5e 25%, transparent 25%, transparent 75%, #f43f5e 75%, #f43f5e)', backgroundPosition: '0 0, 4px 4px', backgroundSize: '8px 8px' }}></div>
                            <div className="absolute inset-0 flex items-center px-2">
                              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Rest Required</span>
                            </div>
                          </div>
                        )}

                        {/* Outing Bar */}
                        <div 
                          className={`absolute top-1/2 -translate-y-1/2 h-10 rounded shadow-sm border ${isActual ? getColorForPitches(o.pitches) : 'bg-white border-dashed border-2'} ${!isActual && o.pitches > 35 ? 'border-amber-400' : ''} ${!isActual && o.pitches <= 35 ? 'border-emerald-400' : ''} z-10 flex items-center px-2 cursor-pointer hover:ring-2 ring-offset-1 ring-slate-300 transition-all overflow-hidden`}
                          style={{ 
                            left: getLeftPercent(game.hour), 
                            width: getLeftPercent(TIMELINE_START + game.length),
                            borderWidth: isActual ? '1px' : '2px'
                          }}
                        >
                          {/* Inner striping for planned */}
                          {!isActual && (
                            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000)', backgroundPosition: '0 0, 4px 4px', backgroundSize: '8px 8px' }}></div>
                          )}
                          
                          <div className="relative z-10 flex flex-col w-full">
                            <div className="flex justify-between items-baseline">
                              <span className={`text-xs font-black ${isActual ? 'text-white' : getTextColorForPitches(o.pitches)}`}>
                                {o.pitches} <span className="opacity-80 text-[9px] uppercase font-bold tracking-wider">{isActual ? 'ACT' : 'PLN'}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="border-t border-slate-200 bg-white p-3 flex justify-between items-center text-xs text-slate-600 font-medium">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-emerald-500 border border-emerald-600 shadow-sm"></div>
              <span>Low (0-25)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-yellow-400 border border-yellow-500 shadow-sm"></div>
              <span>Medium (26-35)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-amber-500 border border-amber-600 shadow-sm"></div>
              <span>High (36-50)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-rose-500 border border-rose-600 shadow-sm"></div>
              <span>Max (51+)</span>
            </div>
            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-slate-200">
              <div className="w-4 h-4 rounded border-2 border-dashed border-emerald-400 bg-white shadow-sm flex items-center justify-center">
                <div className="w-full h-full opacity-20 bg-[repeating-linear-gradient(45deg,#000_25%,transparent_25%,transparent_75%,#000_75%,#000)] [background-size:4px_4px]"></div>
              </div>
              <span>Planned Outing</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-4 rounded-r bg-rose-50 border border-rose-100 shadow-sm relative overflow-hidden">
                <div className="absolute inset-0 opacity-20 bg-[repeating-linear-gradient(45deg,#f43f5e_25%,transparent_25%,transparent_75%,#f43f5e_75%,#f43f5e)] [background-size:4px_4px]"></div>
              </div>
              <span>Required Rest</span>
            </div>
          </div>
          <div>
            <span className="text-slate-400 italic flex items-center gap-1"><Info className="w-3 h-3" /> Click an empty slot to assign a pitcher</span>
          </div>
        </div>
      </div>
    </div>
  );
}

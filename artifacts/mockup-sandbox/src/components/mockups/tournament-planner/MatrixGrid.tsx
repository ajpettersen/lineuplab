import React, { useState } from "react";
import { Info, Plus, ChevronDown, Check, X, ShieldAlert, AlertCircle, Clock, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

// --- DATA ---

const TOURNAMENT = {
  name: "Memorial Day Madness",
  org: "USSSA 12U",
  dates: "May 25-26, 2026",
  location: "Cedar Park Sports Complex",
};

const GAMES = [
  { id: "g1", title: "G1", day: "Saturday", date: "5/25", time: "8:00 AM", opponent: "Bombers (Pool)", status: "completed" },
  { id: "g2", title: "G2", day: "Saturday", date: "5/25", time: "2:00 PM", opponent: "Storm (Pool)", status: "completed" },
  { id: "g3", title: "G3", day: "Sunday", date: "5/26", time: "9:00 AM", opponent: "Eagles (QF)", status: "planned" },
  { id: "g4", title: "G4", day: "Sunday", date: "5/26", time: "12:00 PM", opponent: "TBD (SF)", status: "not_planned" },
  { id: "g5", title: "G5", day: "Sunday", date: "5/26", time: "3:00 PM", opponent: "Championship", status: "planned" },
];

const ROSTER = [
  { id: "p1", num: "7", name: "Tommy Rivera", age: 12, role: "RHP, primary ace" },
  { id: "p2", num: "12", name: "Jake Morales", age: 12, role: "RHP, co-ace" },
  { id: "p3", num: "4", name: "Marco Silva", age: 11, role: "RHP, middle reliever" },
  { id: "p4", num: "22", name: "Lucas Park", age: 12, role: "LHP, middle reliever" },
  { id: "p5", num: "9", name: "Ethan Kim", age: 11, role: "LHP, lefty specialist" },
  { id: "p6", num: "15", name: "Diego Alvarez", age: 12, role: "RHP, middle" },
  { id: "p7", num: "3", name: "Caleb Walsh", age: 10, role: "RHP, back-end" },
  { id: "p8", num: "18", name: "Owen Thomas", age: 11, role: "RHP, back-end" },
];

type PitchRecord = { actual?: number; planned?: number };
type GamePitches = Record<string, PitchRecord>;

const INITIAL_PITCHES: Record<string, GamePitches> = {
  // gameId -> pitcherId -> { actual?: number, planned?: number }
  g1: { p1: { actual: 52 }, p3: { actual: 28 } },
  g2: { p2: { actual: 38 }, p4: { actual: 22 } },
  g3: { p5: { planned: 50 }, p6: { planned: 40 } },
  g4: {},
  g5: { p7: { planned: 30 }, p8: { planned: 30 } },
};

// --- LOGIC & HELPERS ---

function getRestRequired(pitches: number) {
  if (pitches === 0) return 0;
  if (pitches <= 25) return 0;
  if (pitches <= 35) return 0.5; // Represents same-day rest
  if (pitches <= 50) return 1;
  if (pitches <= 65) return 2;
  return 3;
}

// Determines if a pitcher is eligible for a given game based on previous actuals.
// (Simplified logic specific to this scenario)
function getEligibility(pitcherId: string, gameId: string, allPitches: typeof INITIAL_PITCHES) {
  const gameIndex = GAMES.findIndex(g => g.id === gameId);
  const targetGame = GAMES[gameIndex];
  
  let blockedReason = null;
  let isBlocked = false;
  let remainingTotal = 85;

  for (let i = 0; i < gameIndex; i++) {
    const prevGame = GAMES[i];
    const pitchesInGame = allPitches[prevGame.id][pitcherId]?.actual || 0;
    if (pitchesInGame > 0) {
      remainingTotal -= pitchesInGame;
      const restDays = getRestRequired(pitchesInGame);
      
      if (restDays === 0.5 && prevGame.day === targetGame.day) {
        isBlocked = true;
        blockedReason = "Same-day rest required";
      } else if (restDays === 1 && prevGame.day === "Saturday" && targetGame.day === "Saturday") {
        isBlocked = true;
        blockedReason = "1 calendar day required";
      } else if (restDays === 2) {
        // e.g. Pitched Sat, needs Sun and Mon rest -> blocked until Tue.
        // For our Sun games, anyone with 2 cal days from Sat is blocked.
        isBlocked = true;
        blockedReason = "2 cal. days required (Mon)";
      }
    }
  }

  return {
    isBlocked,
    blockedReason,
    remainingTotal: Math.max(0, remainingTotal),
  };
}

export function MatrixGrid() {
  const [pitches, setPitches] = useState(INITIAL_PITCHES);
  const [selectedCell, setSelectedCell] = useState<{gId: string, pId: string} | null>(null);

  // Deriving global status for pitchers
  const pitcherStatuses = ROSTER.map((p) => {
    // Check their state as of "now" (which is Sunday morning in this scenario)
    // G1 and G2 are completed.
    const pitchesSoFar = (pitches.g1[p.id]?.actual || 0) + (pitches.g2[p.id]?.actual || 0);
    const g3Elig = getEligibility(p.id, "g3", pitches);
    
    let status = "READY";
    if (g3Elig.isBlocked) status = "BLOCKED";
    else if (pitchesSoFar > 0) status = "USED";

    return { ...p, status, totalThrown: pitchesSoFar };
  });

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6 font-sans text-slate-900 flex flex-col">
      
      {/* HEADER */}
      <header className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-black tracking-tight text-slate-900">{TOURNAMENT.name}</h1>
            <Badge className="bg-[#1E3A8A] hover:bg-[#1E3A8A] text-white font-bold rounded-sm px-2">USSSA 12U</Badge>
          </div>
          <div className="flex items-center text-sm font-medium text-slate-600 gap-4">
            <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> {TOURNAMENT.dates}</span>
            <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {TOURNAMENT.location}</span>
          </div>
        </div>

        {/* RULES CARD */}
        <Card className="w-80 shadow-sm border-slate-200 shrink-0">
          <CardHeader className="py-2.5 px-4 bg-slate-50 border-b border-slate-100">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> USSSA Pitch Rules (12U)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 py-3 text-xs leading-relaxed grid grid-cols-2 gap-x-2 gap-y-1">
            <div className="flex justify-between"><span>1-25</span><span className="text-slate-500 font-medium">0 Days</span></div>
            <div className="flex justify-between"><span>51-65</span><span className="text-slate-500 font-medium">2 Days</span></div>
            <div className="flex justify-between"><span>26-35</span><span className="text-slate-500 font-medium">Same Day</span></div>
            <div className="flex justify-between"><span>66+</span><span className="text-slate-500 font-medium">3 Days</span></div>
            <div className="flex justify-between"><span>36-50</span><span className="text-slate-500 font-medium">1 Day</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-1 mt-1 col-span-2">
              <span className="font-semibold text-slate-700">Daily Max</span>
              <span className="font-bold text-red-600">85</span>
            </div>
          </CardContent>
        </Card>
      </header>

      {/* MAIN MATRIX CARD */}
      <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <ScrollArea className="flex-1">
          <div className="min-w-[1000px] w-full">
            
            {/* GRID HEADER */}
            <div className="grid grid-cols-[280px_1fr] border-b border-slate-200 bg-slate-50/80 sticky top-0 z-20">
              <div className="p-4 border-r border-slate-200 flex flex-col justify-end">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Roster</span>
              </div>
              
              <div className="grid grid-cols-5 divide-x divide-slate-200">
                {GAMES.map((game, i) => {
                  // Day headers
                  const showDayHeader = i === 0 || GAMES[i-1].day !== game.day;
                  return (
                    <div key={game.id} className="flex flex-col relative group">
                      {showDayHeader && (
                        <div className="absolute -top-7 left-0 right-0 h-7 border-b border-slate-200 bg-slate-100 flex items-center px-3 text-xs font-bold uppercase tracking-widest text-slate-500">
                          {game.day}
                        </div>
                      )}
                      
                      <div className="p-3 flex-1 flex flex-col pt-8">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-base font-black text-slate-800">{game.title}</span>
                          {game.status === 'completed' && <Badge variant="secondary" className="text-[10px] uppercase font-bold bg-slate-100 text-slate-500 hover:bg-slate-100">FINAL</Badge>}
                          {game.status === 'planned' && <Badge variant="secondary" className="text-[10px] uppercase font-bold bg-blue-50 text-blue-600 hover:bg-blue-50 border border-blue-100">PLANNED</Badge>}
                          {game.status === 'not_planned' && <Badge variant="outline" className="text-[10px] uppercase font-bold text-amber-600 border-amber-200 bg-amber-50">NEEDS PLAN</Badge>}
                        </div>
                        <div className="text-xs font-semibold text-slate-600 mb-0.5">{game.time} vs {game.opponent}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* GRID BODY */}
            <div className="flex flex-col divide-y divide-slate-100 relative z-10">
              {pitcherStatuses.map((pitcher) => (
                <div key={pitcher.id} className="grid grid-cols-[280px_1fr] hover:bg-slate-50/50 transition-colors">
                  
                  {/* PITCHER ROW HEADER */}
                  <div className="p-3 border-r border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0 border border-slate-200">
                        {pitcher.num}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-900 leading-tight">{pitcher.name}</span>
                        <span className="text-xs text-slate-500 font-medium">{pitcher.role}</span>
                      </div>
                    </div>
                    <div>
                      {pitcher.status === "READY" && <div className="w-2 h-2 rounded-full bg-emerald-500" title="Fresh" />}
                      {pitcher.status === "USED" && <div className="w-2 h-2 rounded-full bg-blue-500" title="Used but eligible" />}
                      {pitcher.status === "BLOCKED" && <div className="w-2 h-2 rounded-full bg-red-500" title="Blocked by rest rules" />}
                    </div>
                  </div>

                  {/* GAME CELLS */}
                  <div className="grid grid-cols-5 divide-x divide-slate-100">
                    {GAMES.map((game) => {
                      const entry = pitches[game.id as keyof typeof pitches][pitcher.id];
                      const actual = entry?.actual;
                      const planned = entry?.planned;
                      
                      const elig = getEligibility(pitcher.id, game.id, pitches);
                      
                      const isPast = game.status === 'completed';
                      const hasData = actual !== undefined || planned !== undefined;

                      return (
                        <div 
                          key={`${pitcher.id}-${game.id}`} 
                          className={`p-2 relative flex flex-col justify-center
                            ${elig.isBlocked && !isPast ? 'bg-slate-50/50' : ''}
                            ${!hasData && !elig.isBlocked && !isPast ? 'group/cell hover:bg-slate-50 cursor-pointer' : ''}
                          `}
                        >
                          {/* Blocked State */}
                          {elig.isBlocked && !isPast && !hasData && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <HoverCard>
                                <HoverCardTrigger>
                                  <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 opacity-60">
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                    Resting
                                  </div>
                                </HoverCardTrigger>
                                <HoverCardContent className="w-48 text-xs">
                                  Blocked: {elig.blockedReason}
                                </HoverCardContent>
                              </HoverCard>
                            </div>
                          )}

                          {/* Data State (Actual) */}
                          {actual !== undefined && (
                            <div className="bg-[#1E3A8A]/5 border border-[#1E3A8A]/20 rounded-md p-2 flex flex-col items-center justify-center relative shadow-sm h-full">
                              <span className="text-[10px] uppercase font-bold text-[#1E3A8A]/60 tracking-wider mb-0.5">Actual</span>
                              <span className="text-2xl font-black text-[#1E3A8A] leading-none">{actual}</span>
                            </div>
                          )}

                          {/* Data State (Planned) */}
                          {planned !== undefined && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="w-full h-full bg-orange-50 border border-orange-200 border-dashed rounded-md p-2 flex flex-col items-center justify-center hover:bg-orange-100/70 transition-colors text-left text-inherit font-inherit">
                                  <span className="text-[10px] uppercase font-bold text-orange-600/70 tracking-wider mb-0.5">Planned</span>
                                  <span className="text-2xl font-black text-orange-600 leading-none">{planned}</span>
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-56 p-3">
                                <p className="text-sm font-semibold mb-2">Edit Plan for {game.title}</p>
                                <div className="flex gap-2">
                                  <Button variant="outline" size="sm" className="flex-1">Clear</Button>
                                  <Button size="sm" className="flex-1 bg-orange-600 hover:bg-orange-700">Save</Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}

                          {/* Empty/Eligible Add Button */}
                          {!hasData && !elig.isBlocked && !isPast && (
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity">
                              <Button variant="secondary" size="icon" className="w-8 h-8 rounded-full shadow-sm bg-white hover:bg-orange-50 hover:text-orange-600 border border-slate-200 hover:border-orange-200">
                                <Plus className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* FOOTER SUMMARY */}
      <div className="mt-4 bg-white border border-slate-200 rounded-lg shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Fresh Arms</span>
            <span className="text-lg font-black text-emerald-600">4</span>
          </div>
          <div className="w-px h-8 bg-slate-200" />
          <div className="flex flex-col">
            <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Total Remaining Staff Capacity</span>
            <span className="text-lg font-black text-slate-800">550+ pitches</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 font-bold px-3 py-1 text-xs">
            <AlertCircle className="w-3.5 h-3.5 mr-1.5 inline-block" />
            G4 needs a plan
          </Badge>
          <Button className="bg-[#1E3A8A] hover:bg-[#1E3A8A]/90 text-white font-bold tracking-wide">
            Save Weekend Plan
          </Button>
        </div>
      </div>
    </div>
  );
}

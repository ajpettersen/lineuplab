import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CalendarDays, Clock, MapPin, AlertCircle, Info, ArrowRight, ShieldAlert, CheckCircle2 } from "lucide-react";

export function BullpenStack() {
  return (
    <div className="min-h-screen bg-neutral-100 p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Memorial Day Madness</h1>
              <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">USSSA 12U</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-neutral-500 text-sm font-medium">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4" />
                <span>May 25-26, 2026</span>
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                <span>Cedar Park Sports Complex</span>
              </div>
            </div>
          </div>
          
          <Card className="bg-neutral-50 border-neutral-200 shadow-none max-w-sm">
            <CardHeader className="py-3 px-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-neutral-700">
                <Info className="w-4 h-4" />
                USSSA 12U Pitch Rules
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-4 pt-0">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-600">
                <div className="flex justify-between"><span>1-25:</span> <span className="font-semibold">0 days</span></div>
                <div className="flex justify-between"><span>51-65:</span> <span className="font-semibold">2 days</span></div>
                <div className="flex justify-between"><span>26-35:</span> <span className="font-semibold">Same day</span></div>
                <div className="flex justify-between"><span>66+:</span> <span className="font-semibold">3 days</span></div>
                <div className="flex justify-between"><span>36-50:</span> <span className="font-semibold">1 day</span></div>
                <div className="flex justify-between"><span>Max:</span> <span className="font-semibold text-neutral-900">85/day</span></div>
              </div>
            </CardContent>
          </Card>
        </header>

        {/* Stack of Games */}
        <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory hide-scrollbar">
          
          {/* G1 - Completed */}
          <GameCard
            title="G1 vs Bombers"
            status="completed"
            time="Sat 5/25 • 8:00 AM"
            type="Pool Play"
            assignments={[
              { name: "Tommy Rivera", number: 7, throws: "R", pitches: 52, type: "actual", note: "Needs 2 days rest" },
              { name: "Marco Silva", number: 4, throws: "R", pitches: 28, type: "actual", note: "Same day rest" }
            ]}
          />

          {/* G2 - Completed */}
          <GameCard
            title="G2 vs Storm"
            status="completed"
            time="Sat 5/25 • 2:00 PM"
            type="Pool Play"
            assignments={[
              { name: "Jake Morales", number: 12, throws: "R", pitches: 38, type: "actual", note: "Needs 1 day rest" },
              { name: "Lucas Park", number: 22, throws: "L", pitches: 22, type: "actual", note: "No rest required" }
            ]}
          />

          {/* G3 - Planned */}
          <GameCard
            title="G3 vs Eagles"
            status="planned"
            time="Sun 5/26 • 9:00 AM"
            type="Quarterfinal"
            bullpen={[
              { name: "Jake Morales", number: 12, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Marco Silva", number: 4, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Lucas Park", number: 22, throws: "L", pitchesLeft: 63, status: "used" },
              { name: "Caleb Walsh", number: 3, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Owen Thomas", number: 18, throws: "R", pitchesLeft: 85, status: "fresh" },
            ]}
            assignments={[
              { name: "Ethan Kim", number: 9, throws: "L", pitches: 50, type: "planned" },
              { name: "Diego Alvarez", number: 15, throws: "R", pitches: 40, type: "planned" }
            ]}
          />

          {/* G4 - Unplanned */}
          <GameCard
            title="G4 vs TBD"
            status="open"
            time="Sun 5/26 • 12:00 PM"
            type="Semifinal"
            bullpen={[
              { name: "Jake Morales", number: 12, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Marco Silva", number: 4, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Lucas Park", number: 22, throws: "L", pitchesLeft: 63, status: "used" },
              { name: "Caleb Walsh", number: 3, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Owen Thomas", number: 18, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Ethan Kim", number: 9, throws: "L", pitchesLeft: 35, status: "warning" },
              { name: "Diego Alvarez", number: 15, throws: "R", pitchesLeft: 45, status: "warning" }
            ]}
            assignments={[]}
          />

          {/* G5 - Planned */}
          <GameCard
            title="G5 Championship"
            status="planned"
            time="Sun 5/26 • 3:00 PM"
            type="Championship"
            bullpen={[
              { name: "Jake Morales", number: 12, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Marco Silva", number: 4, throws: "R", pitchesLeft: 85, status: "fresh" },
              { name: "Lucas Park", number: 22, throws: "L", pitchesLeft: 63, status: "used" },
              { name: "Ethan Kim", number: 9, throws: "L", pitchesLeft: 35, status: "warning" },
              { name: "Diego Alvarez", number: 15, throws: "R", pitchesLeft: 45, status: "warning" }
            ]}
            assignments={[
              { name: "Caleb Walsh", number: 3, throws: "R", pitches: 30, type: "planned" },
              { name: "Owen Thomas", number: 18, throws: "R", pitches: 30, type: "planned" }
            ]}
          />

        </div>

        {/* Blocked Roster */}
        <div className="bg-white rounded-lg border border-neutral-200 p-4 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3 text-neutral-600 text-sm">
            <ShieldAlert className="w-5 h-5 text-red-500" />
            <span className="font-medium">Unavailable Sunday</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-neutral-100 px-3 py-1.5 rounded-full border border-neutral-200">
              <span className="font-bold text-neutral-500 text-xs">#7</span>
              <span className="text-sm font-medium text-neutral-700">Tommy Rivera</span>
              <span className="text-xs text-neutral-500 ml-2">(Resting until Mon)</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function GameCard({ title, status, time, type, bullpen = [], assignments = [] }: any) {
  const isCompleted = status === "completed";
  const isOpen = status === "open";
  const isPlanned = status === "planned";

  return (
    <Card className={`min-w-[320px] max-w-[320px] shrink-0 snap-center flex flex-col transition-all duration-200 ${
      isOpen ? 'border-amber-400 shadow-md ring-1 ring-amber-400 ring-offset-2' : 
      isCompleted ? 'bg-neutral-50 border-neutral-200 opacity-80' : 
      'border-neutral-300 shadow-sm'
    }`}>
      {/* Header */}
      <div className={`p-4 border-b ${
        isOpen ? 'bg-amber-50 rounded-t-lg border-amber-200' :
        isCompleted ? 'bg-neutral-100 rounded-t-lg border-neutral-200' :
        'bg-slate-50 rounded-t-lg border-slate-200'
      }`}>
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="font-bold text-lg text-neutral-900 leading-tight">{title}</h3>
            <p className="text-xs font-semibold text-neutral-500 tracking-wider uppercase mt-1">{type}</p>
          </div>
          {isOpen && <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Needs Plan</Badge>}
          {isCompleted && <Badge variant="outline" className="bg-neutral-200 text-neutral-600 border-neutral-300">Final</Badge>}
          {isPlanned && <Badge variant="outline" className="bg-slate-200 text-slate-700 border-slate-300">Planned</Badge>}
        </div>
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-600">
          <Clock className="w-4 h-4" />
          {time}
        </div>
      </div>

      {/* Available Bullpen */}
      {!isCompleted && (
        <div className="p-3 bg-neutral-50 flex-1 flex flex-col gap-2">
          <div className="text-xs font-bold text-neutral-400 uppercase tracking-wider px-1">Available Bullpen</div>
          <ScrollArea className="h-[220px] pr-3">
            <div className="space-y-2 pb-2">
              {bullpen.length > 0 ? bullpen.map((p: any, idx: number) => (
                <div key={idx} className="group relative flex items-center justify-between p-2 rounded-md bg-white border border-neutral-200 shadow-sm hover:border-slate-400 cursor-grab active:cursor-grabbing transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-neutral-100 border border-neutral-200 flex items-center justify-center text-xs font-bold text-neutral-600">
                      {p.number}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-neutral-800 leading-none">{p.name}</div>
                      <div className="text-[10px] font-bold text-neutral-400 mt-1">{p.throws}HP</div>
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs font-bold ${
                    p.status === 'fresh' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    p.status === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                    'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}>
                    {p.pitchesLeft} left
                  </div>
                </div>
              )) : (
                <div className="h-full flex items-center justify-center p-4 text-center text-sm text-neutral-400 italic">
                  No available pitchers
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Assignments */}
      <div className={`p-3 border-t mt-auto ${isCompleted ? 'bg-neutral-50 flex-1' : 'bg-white rounded-b-lg'}`}>
        <div className="text-xs font-bold text-neutral-400 uppercase tracking-wider px-1 mb-3 flex items-center justify-between">
          <span>{isCompleted ? 'Actual Outings' : 'Assignments'}</span>
          {isOpen && <span className="text-amber-600">Drag pitchers here</span>}
        </div>
        <div className="space-y-2">
          {assignments.length > 0 ? assignments.map((a: any, idx: number) => (
            <div key={idx} className={`relative flex flex-col p-2.5 rounded-lg border ${
              a.type === 'actual' ? 'bg-neutral-100 border-neutral-300' : 'bg-slate-50 border-slate-300 shadow-sm'
            }`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-white border border-neutral-200 flex items-center justify-center text-xs font-bold text-neutral-700">
                    {a.number}
                  </div>
                  <span className="text-sm font-bold text-neutral-900">{a.name}</span>
                </div>
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                  a.type === 'actual' ? 'bg-neutral-800 text-white' : 'bg-blue-600 text-white shadow-sm'
                }`}>
                  {a.pitches} {a.type === 'actual' ? 'thrown' : 'planned'}
                </div>
              </div>
              {a.note && (
                <div className="text-[11px] font-medium text-neutral-500 pl-8 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" />
                  {a.note}
                </div>
              )}
            </div>
          )) : (
            <div className="border-2 border-dashed border-amber-300 bg-amber-50/50 rounded-lg p-6 text-center">
              <p className="text-sm font-medium text-amber-700">No plan set</p>
              <button className="mt-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded shadow-sm transition-colors">
                Auto-assign
              </button>
            </div>
          )}
        </div>
      </div>

    </Card>
  );
}

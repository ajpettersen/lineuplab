import React from "react";

export function HeritageScorecard() {
  return (
    <div className="relative w-full h-[900px] overflow-hidden select-none" style={{ backgroundColor: "#F7F5EE", color: "#111C33", fontFamily: "'DM Serif Display', serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&family=Caveat:wght@400;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{
        __html: `
          .paper-texture {
            background-image: 
              linear-gradient(rgba(17, 28, 51, 0.05) 1px, transparent 1px),
              linear-gradient(90deg, rgba(17, 28, 51, 0.05) 1px, transparent 1px);
            background-size: 20px 20px;
          }
          .handwritten {
            font-family: 'Caveat', cursive;
          }
          .serif-text {
            font-family: 'Playfair Display', serif;
          }
          .display-text {
            font-family: 'DM Serif Display', serif;
          }
          .vintage-red {
            color: #A32A2A;
          }
          .bg-vintage-red {
            background-color: #A32A2A;
          }
          .ink-blue {
            color: #111C33;
          }
          .border-ink-blue {
            border-color: #111C33;
          }
          .bg-ink-blue {
            background-color: #111C33;
          }
          .stitching {
            border-bottom: 2px dashed #A32A2A;
          }
        `
      }} />

      {/* Background Texture */}
      <div className="absolute inset-0 paper-texture opacity-50 pointer-events-none"></div>

      {/* Main Container */}
      <div className="relative z-10 w-full h-full flex flex-col p-6">
        
        {/* Header - Masthead */}
        <header className="flex flex-col items-center justify-center border-b-4 border-double border-ink-blue pb-6 mb-6">
          <div className="flex items-center justify-between w-full max-w-4xl">
            <div className="flex flex-col items-center flex-1">
              <span className="text-xl serif-text tracking-widest uppercase mb-1">Visitors</span>
              <span className="text-5xl display-text">TIGERS</span>
            </div>
            
            <div className="flex flex-col items-center px-12 border-x-2 border-ink-blue/30">
              <div className="flex items-center gap-6 mb-2">
                <span className="text-6xl display-text vintage-red">2</span>
                <span className="text-2xl text-ink-blue/50">—</span>
                <span className="text-6xl display-text ink-blue">4</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-lg serif-text font-bold uppercase tracking-widest bg-ink-blue text-[#F7F5EE] px-3 py-1">Top of 3rd</span>
                <span className="text-sm serif-text italic mt-2">Time: 00:42</span>
              </div>
            </div>

            <div className="flex flex-col items-center flex-1">
              <span className="text-xl serif-text tracking-widest uppercase mb-1">Home</span>
              <span className="text-5xl display-text">WILDCATS</span>
            </div>
          </div>
        </header>

        {/* Main Content Split */}
        <div className="flex flex-1 gap-8 min-h-0">
          
          {/* Left Side: Field & Bench */}
          <div className="flex-1 flex flex-col border-r-2 border-ink-blue/20 pr-8">
            
            {/* Field Area */}
            <div className="flex-1 relative flex items-center justify-center bg-[#F7F5EE] border-2 border-ink-blue rounded-t-[40%] rounded-b-md shadow-[inset_0_0_40px_rgba(0,0,0,0.05)] overflow-hidden">
              
              {/* Dirt / Infield Abstraction */}
              <div className="absolute w-[600px] h-[600px] border border-ink-blue/20 rotate-45 transform translate-y-10"></div>
              <div className="absolute w-[400px] h-[400px] border-2 border-ink-blue/40 rotate-45 transform translate-y-20 flex items-center justify-center">
                {/* Bases */}
                <div className="absolute top-0 left-0 w-8 h-8 bg-[#F7F5EE] border-2 border-ink-blue -translate-x-1/2 -translate-y-1/2 rotate-45"></div>
                <div className="absolute top-0 right-0 w-8 h-8 bg-[#F7F5EE] border-2 border-ink-blue translate-x-1/2 -translate-y-1/2 rotate-45"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 bg-[#F7F5EE] border-2 border-ink-blue translate-x-1/2 translate-y-1/2 rotate-45"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 bg-[#F7F5EE] border-2 border-ink-blue -translate-x-1/2 translate-y-1/2 rotate-45" style={{ borderRadius: '50% 50% 0 0' }}></div>
              </div>

              {/* Pitcher's Mound */}
              <div className="absolute w-24 h-24 border border-ink-blue/30 rounded-full flex items-center justify-center transform translate-y-10">
                <div className="w-8 h-3 border border-ink-blue bg-[#F7F5EE]"></div>
              </div>

              {/* Players on Field */}
              <FieldPlayer pos="P" name="Marcus J." className="top-[55%] left-1/2 -translate-x-1/2 -translate-y-1/2" />
              <FieldPlayer pos="C" name="Diego R." className="bottom-[5%] left-1/2 -translate-x-1/2" />
              <FieldPlayer pos="1B" name="Tyler K." className="top-[60%] right-[20%]" />
              <FieldPlayer pos="2B" name="Aiden P." className="top-[45%] right-[30%]" />
              <FieldPlayer pos="SS" name="Noah L." className="top-[45%] left-[30%]" />
              <FieldPlayer pos="3B" name="Hunter M." className="top-[60%] left-[20%]" />
              <FieldPlayer pos="LF" name="Mason B." className="top-[25%] left-[15%]" />
              <FieldPlayer pos="CF" name="Logan S." className="top-[15%] left-1/2 -translate-x-1/2" />
              <FieldPlayer pos="RF" name="Owen T." className="top-[25%] right-[15%]" />
              
            </div>

            {/* Bench Strip */}
            <div className="mt-6 border-t border-ink-blue/30 pt-4 pb-2">
              <h3 className="text-sm serif-text uppercase tracking-widest font-bold mb-3 vintage-red">Bench</h3>
              <div className="flex gap-4">
                {["Liam W.", "Ethan G.", "Jackson D."].map((name, i) => (
                  <div key={i} className="flex items-center border border-ink-blue/40 bg-white/50 px-3 py-1 shadow-sm">
                    <span className="text-xs font-bold mr-2 serif-text">BN</span>
                    <span className="handwritten text-xl leading-none pt-1">{name}</span>
                  </div>
                ))}
              </div>
            </div>
            
          </div>

          {/* Right Side: Batting Order */}
          <div className="w-[350px] flex flex-col">
            <div className="border-b-2 border-ink-blue pb-2 mb-4 flex items-center justify-between">
              <h2 className="text-2xl display-text uppercase tracking-wider">Batting Order</h2>
              <span className="text-sm serif-text italic text-ink-blue/60">Official Lineup</span>
            </div>
            
            <div className="flex-1 flex flex-col bg-white/30 border border-ink-blue/20 p-4 shadow-sm relative">
              {/* Ruled lines background for the lineup card */}
              <div className="absolute inset-0 pointer-events-none" style={{ 
                backgroundImage: 'repeating-linear-gradient(transparent, transparent 47px, rgba(17, 28, 51, 0.1) 47px, rgba(17, 28, 51, 0.1) 48px)',
                backgroundPositionY: '8px'
              }}></div>
              
              <div className="flex flex-col relative z-10">
                {[
                  { pos: "SS", name: "Noah L." },
                  { pos: "P", name: "Marcus J." },
                  { pos: "C", name: "Diego R." },
                  { pos: "1B", name: "Tyler K." },
                  { pos: "3B", name: "Hunter M." },
                  { pos: "2B", name: "Aiden P." },
                  { pos: "LF", name: "Mason B." },
                  { pos: "CF", name: "Logan S." },
                  { pos: "RF", name: "Owen T." },
                  { pos: "BN", name: "Liam W." },
                  { pos: "BN", name: "Ethan G." },
                  { pos: "BN", name: "Jackson D." }
                ].map((batter, i) => (
                  <div key={i} className="flex items-center h-[48px]">
                    <div className="w-8 flex justify-center items-center">
                      <span className="serif-text font-bold text-ink-blue/60 text-lg">{i + 1}.</span>
                    </div>
                    <div className="w-10 flex justify-center mx-2">
                      <span className={`text-xs serif-text font-bold ${batter.pos === 'BN' ? 'text-ink-blue/40' : 'vintage-red'} border ${batter.pos === 'BN' ? 'border-ink-blue/20' : 'border-[#A32A2A]/40'} px-1 py-[2px] leading-none bg-[#F7F5EE]`}>
                        {batter.pos}
                      </span>
                    </div>
                    <div className="flex-1 border-b border-dashed border-ink-blue/30 h-full flex items-end pb-2">
                      <span className="handwritten text-2xl ml-2">{batter.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
          </div>
          
        </div>
      </div>
    </div>
  );
}

function FieldPlayer({ pos, name, className }: { pos: string, name: string, className: string }) {
  return (
    <div className={`absolute flex flex-col items-center ${className}`}>
      <div className="bg-[#F7F5EE] border border-ink-blue shadow-sm px-2 py-1 flex items-center gap-2 transform -rotate-2 hover:rotate-0 transition-transform">
        <span className="text-[10px] serif-text font-bold uppercase vintage-red border-r border-ink-blue/20 pr-2">{pos}</span>
        <span className="handwritten text-lg leading-none pt-1">{name}</span>
      </div>
    </div>
  );
}

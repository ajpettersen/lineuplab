import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetPlayer,
  useGetPlayerStats,
  useUpdatePlayer,
  getListPlayersQueryKey,
  getGetPlayerQueryKey,
  getGetPlayerStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Edit, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toastError } from "@/lib/toast-error";

const ALL_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

const POSITION_LABELS: Record<string, string> = {
  P: "Pitcher",
  C: "Catcher",
  "1B": "First Base",
  "2B": "Second Base",
  "3B": "Third Base",
  SS: "Shortstop",
  LF: "Left Field",
  CF: "Center Field",
  RF: "Right Field",
};

export default function PlayerDetail() {
  const [, params] = useRoute("/players/:id");
  const id = parseInt(params?.id ?? "0");
  const { data: player, isLoading } = useGetPlayer(id, {
    query: { enabled: !!id, queryKey: getGetPlayerQueryKey(id) },
  });
  const { data: allStats = [] } = useGetPlayerStats({
    query: { queryKey: getGetPlayerStatsQueryKey() },
  });
  const stats = allStats.find((s) => s.playerId === id) as
    | (typeof allStats[number] & { unavailableInnings?: number })
    | undefined;
  const updatePlayer = useUpdatePlayer();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [number, setNumber] = useState("");
  const [preferred, setPreferred] = useState<string[]>([]);
  const [canPitch, setCanPitch] = useState(false);
  const [active, setActive] = useState(true);

  const startEdit = () => {
    if (!player) return;
    // Legacy rows (imported before firstName/lastName became required)
    // may have a populated `name` with empty/null firstName + lastName.
    // Without this fallback, opening Edit just to toggle a preferred
    // position would force the coach to re-type the player's name
    // before Save would accept the form. Split on the last whitespace
    // (same convention the bulk-import uses).
    let f = player.firstName ?? "";
    let l = player.lastName ?? "";
    if ((!f || !l) && player.name) {
      const full = player.name.trim();
      const idx = full.lastIndexOf(" ");
      if (idx > 0) {
        if (!f) f = full.slice(0, idx).trim();
        if (!l) l = full.slice(idx + 1).trim();
      } else if (!f) {
        // Single-token name: keep it as the first name, leave last blank
        // so the coach can fill it in if they want — but they aren't
        // forced to (see handleSave for the matching relaxation).
        f = full;
      }
    }
    setFirstName(f);
    setLastName(l);
    setNumber(player.number != null ? String(player.number) : "");
    setPreferred(player.preferredPositions);
    setCanPitch(player.canPitch);
    setActive(player.active);
    setEditing(true);
  };

  const togglePreferred = (pos: string) => {
    setPreferred((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );
  };

  const handleSave = () => {
    const f = firstName.trim();
    const l = lastName.trim();
    if (!f) {
      toast({ title: "First name is required", variant: "destructive" });
      return;
    }
    // Last name is tolerated as empty so coaches editing legacy
    // single-token roster rows (e.g. nickname-only) aren't blocked from
    // toggling a preferred position. The server schema allows an empty
    // lastName for the same reason (see replit.md → "Roster Names").
    updatePlayer.mutate(
      {
        id,
        data: {
          firstName: f,
          lastName: l,
          number: number ? parseInt(number) : null,
          // eligiblePositions is server-derived from canPitch; we send the
          // current full list (server overwrites it) just to satisfy the
          // generated zod schema, which still requires the field.
          eligiblePositions: ALL_POSITIONS,
          preferredPositions: preferred,
          canPitch,
          active,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetPlayerQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListPlayersQueryKey() });
          toast({ title: "Player updated" });
          setEditing(false);
        },
        onError: (err) => toastError(toast, "Failed to update", err),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-48 bg-muted rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!player) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Player not found.</p>
        <Link href="/players">
          <Button variant="link" className="mt-2">Back to Roster</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/players">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Roster
          </Button>
        </Link>
      </div>

      {!editing && (
        <div>
          <div className="eyebrow text-primary/70">Player Card</div>
          <h1 className="page-title text-foreground mt-1 flex items-baseline gap-3 flex-wrap">
            {player.number != null && (
              <span className="font-numeric text-foreground/40 text-2xl md:text-3xl">
                #{player.number}
              </span>
            )}
            <span>{player.name}</span>
            {!player.active && (
              <Badge variant="outline" className="self-center">Inactive</Badge>
            )}
          </h1>
        </div>
      )}

      <Card className="relative overflow-hidden broadcast-stripe">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            {editing ? (
              <div className="flex gap-2 flex-wrap">
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First"
                  className="text-xl font-bold h-9 w-36"
                  data-testid="input-edit-first-name"
                />
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last"
                  className="text-xl font-bold h-9 w-40"
                  data-testid="input-edit-last-name"
                />
                <Input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="#"
                  type="number"
                  className="w-20 h-9"
                />
              </div>
            ) : (
              <CardTitle className="text-base text-muted-foreground font-broadcast uppercase tracking-wider">
                Profile
              </CardTitle>
            )}
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={updatePlayer.isPending}>
                  <Save className="h-4 w-4 mr-1" /> Save
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Edit className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editing ? (
            <>
              <div className="flex flex-col gap-2">
                <Label>Preferred Positions</Label>
                <p className="text-xs text-muted-foreground">
                  Tap positions this player likes or plays best. The lineup
                  generator will favor them when fairness allows. Leave it
                  empty if they have no strong preference — every player can
                  play any position.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {ALL_POSITIONS.map((pos) => (
                    <label
                      key={pos}
                      className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer text-sm transition-colors ${
                        preferred.includes(pos)
                          ? "border-primary bg-primary/5 text-primary font-medium"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      <Checkbox
                        checked={preferred.includes(pos)}
                        onCheckedChange={() => togglePreferred(pos)}
                      />
                      {pos}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={canPitch} onCheckedChange={(v) => setCanPitch(!!v)} />
                  <span className="text-sm">Can pitch</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={active} onCheckedChange={(v) => setActive(!!v)} />
                  <span className="text-sm">Active on roster</span>
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Preferred Positions</Label>
                {player.preferredPositions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {player.preferredPositions.map((pos) => (
                      <Badge key={pos} variant="default">
                        {pos}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No preferences — can play anywhere.
                  </p>
                )}
              </div>
              {player.canPitch && (
                <Badge variant="outline" className="w-fit text-primary border-primary/40">
                  Can Pitch
                </Badge>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Rotation Report */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rotation Report</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.gamesPlayed}</div>
                <div className="text-xs text-muted-foreground">Games Played</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.totalInnings - stats.benchInnings}</div>
                <div className="text-xs text-muted-foreground">Field Innings</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${stats.benchInnings > 4 ? "text-yellow-600" : "text-foreground"}`}>
                  {stats.benchInnings}
                </div>
                <div className="text-xs text-muted-foreground">Bench Innings</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${(stats.unavailableInnings ?? 0) > 0 ? "text-amber-600" : "text-foreground"}`}>
                  {stats.unavailableInnings ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">Out (Unavailable)</div>
              </div>
            </div>
            {Object.keys(stats.positionInnings).length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Innings by Position</Label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(stats.positionInnings)
                    .sort((a, b) => b[1] - a[1])
                    .map(([pos, count]) => (
                      <div
                        key={pos}
                        className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 text-sm"
                      >
                        <span className="font-medium">{POSITION_LABELS[pos] ?? pos}</span>
                        <span className="text-muted-foreground font-mono">{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

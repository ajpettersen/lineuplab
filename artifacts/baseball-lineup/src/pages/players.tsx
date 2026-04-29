import { useState } from "react";
import { Link } from "wouter";
import {
  useListPlayers,
  useCreatePlayer,
  useDeletePlayer,
  getListPlayersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserPlus, Trash2, ChevronRight, CircleUser } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ALL_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

function AddPlayerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const createPlayer = useCreatePlayer();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [eligible, setEligible] = useState<string[]>([]);
  const [preferred, setPreferred] = useState<string[]>([]);
  const [canPitch, setCanPitch] = useState(false);

  const toggleEligible = (pos: string) => {
    setEligible((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );
    if (!eligible.includes(pos)) {
      // removing from eligible removes from preferred too
    } else {
      setPreferred((prev) => prev.filter((p) => p !== pos));
    }
  };

  const togglePreferred = (pos: string) => {
    if (!eligible.includes(pos)) return;
    setPreferred((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (eligible.length === 0) {
      toast({ title: "Select at least one eligible position", variant: "destructive" });
      return;
    }
    createPlayer.mutate(
      {
        data: {
          name: name.trim(),
          number: number ? parseInt(number) : null,
          eligiblePositions: eligible,
          preferredPositions: preferred,
          canPitch,
          active: true,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPlayersQueryKey() });
          toast({ title: "Player added" });
          onClose();
          setName("");
          setNumber("");
          setEligible([]);
          setPreferred([]);
          setCanPitch(false);
        },
        onError: () => toast({ title: "Failed to add player", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Player</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="First Last"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Jersey #</Label>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="Optional"
                type="number"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Eligible Positions</Label>
            <div className="grid grid-cols-3 gap-2">
              {ALL_POSITIONS.map((pos) => (
                <label
                  key={pos}
                  className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer text-sm transition-colors ${
                    eligible.includes(pos)
                      ? "border-primary bg-primary/5 text-primary font-medium"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <Checkbox
                    checked={eligible.includes(pos)}
                    onCheckedChange={() => toggleEligible(pos)}
                  />
                  {pos}
                </label>
              ))}
            </div>
          </div>
          {eligible.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Preferred Positions (subset of eligible)</Label>
              <div className="flex flex-wrap gap-2">
                {eligible.map((pos) => (
                  <label
                    key={pos}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border cursor-pointer text-sm transition-colors ${
                      preferred.includes(pos)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <Checkbox
                      checked={preferred.includes(pos)}
                      onCheckedChange={() => togglePreferred(pos)}
                      className="hidden"
                    />
                    {pos}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="canPitch"
              checked={canPitch}
              onCheckedChange={(v) => setCanPitch(!!v)}
            />
            <Label htmlFor="canPitch">Can pitch</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createPlayer.isPending}>
            {createPlayer.isPending ? "Adding..." : "Add Player"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Players() {
  const { data: players = [], isLoading } = useListPlayers();
  const deletePlayer = useDeletePlayer();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const handleDelete = () => {
    if (!deleteId) return;
    deletePlayer.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPlayersQueryKey() });
          toast({ title: "Player removed" });
          setDeleteId(null);
        },
        onError: () => toast({ title: "Failed to delete player", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Roster</h1>
          <p className="text-muted-foreground mt-1">{players.length} players</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add Player
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : players.length === 0 ? (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-3 text-center">
            <CircleUser className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">No players yet. Add your first player to get started.</p>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" /> Add Player
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => (
            <Card key={p.id} className="border-border hover:border-primary/30 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <Link href={`/players/${p.id}`}>
                    <div className="flex-1 cursor-pointer group">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-mono w-6">
                          {p.number != null ? `#${p.number}` : ""}
                        </span>
                        <span className="font-semibold group-hover:text-primary transition-colors">
                          {p.name}
                        </span>
                        {!p.active && (
                          <Badge variant="outline" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2 ml-8">
                        {p.eligiblePositions.map((pos) => (
                          <Badge
                            key={pos}
                            variant={p.preferredPositions.includes(pos) ? "default" : "secondary"}
                            className="text-xs px-1.5 py-0"
                          >
                            {pos}
                          </Badge>
                        ))}
                        {p.canPitch && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 text-primary border-primary/40">
                            Pitcher
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1">
                    <Link href={`/players/${p.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(p.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddPlayerDialog open={addOpen} onClose={() => setAddOpen(false)} />

      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove player?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the player and all their lineup history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

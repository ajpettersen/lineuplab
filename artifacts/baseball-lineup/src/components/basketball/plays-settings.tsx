import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/lib/confirm";
import { toastError } from "@/lib/toast-error";
import { GROUP_LAYOUTS, type GroupLayoutId } from "@/lib/basketball-rotation";
import { deletePlay, fetchPlays, PLAYS_KEY, savePlay, stepCount, type BasketballPlay } from "@/lib/basketball-plays";
import { BASKETBALL_SETUP_KEY, fetchBasketballSetup } from "@/lib/basketball-setup";
import { PlayDiagram } from "@/components/basketball/court";
import { PlayEditor, type PlayDraft } from "@/components/basketball/play-editor";

/** Settings → Plays: the team's drawn plays, shown on the court display at timeouts. */
export function PlaysSettings({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data: plays = [], isLoading } = useQuery({ queryKey: PLAYS_KEY, queryFn: fetchPlays });
  const { data: setup } = useQuery({ queryKey: BASKETBALL_SETUP_KEY, queryFn: fetchBasketballSetup });
  const [editing, setEditing] = useState<BasketballPlay | "new" | null>(null);
  const defaultLayout: GroupLayoutId = setup?.settings.groupLayout ?? "guards-front";

  const save = useMutation({
    mutationFn: (draft: PlayDraft) => savePlay(draft),
    onSuccess: async (saved) => {
      setEditing(null);
      await qc.invalidateQueries({ queryKey: PLAYS_KEY });
      toast({ title: `Saved "${saved.name}"` });
    },
    onError: (err) => toastError(toast, "Couldn't save the play", err),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deletePlay(id),
    onSuccess: async () => {
      setEditing(null);
      await qc.invalidateQueries({ queryKey: PLAYS_KEY });
    },
    onError: (err) => toastError(toast, "Couldn't delete the play", err),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Plays</CardTitle>
          <CardDescription>
            Draw your plays here. At a timeout, open them from the Plays button on a game's court display: your five on the
            floor show up on their spots.
          </CardDescription>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing("new")} className="gap-1"><Plus className="h-4 w-4" /> New play</Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : plays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plays yet.{canEdit ? " Tap New play to draw your first one." : ""}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {plays.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => canEdit && setEditing(p)}
                  disabled={!canEdit}
                  className="w-full overflow-hidden rounded-md border text-left transition-colors hover:border-primary disabled:cursor-default"
                >
                  <div className="aspect-[500/470] w-full">
                    <PlayDiagram data={p.data} groupLayout={p.groupLayout} />
                  </div>
                  <div className="border-t px-2 py-1.5">
                    <div className="truncate text-sm font-bold">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {GROUP_LAYOUTS[p.groupLayout]?.label ?? ""} · {stepCount(p.data)} step{stepCount(p.data) === 1 ? "" : "s"}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[94dvh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New play" : "Edit play"}</DialogTitle>
            <DialogDescription>Drag the players into place, pick a line type, then draw on the court.</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <PlayEditor
              key={editing === "new" ? "new" : editing.id}
              initial={editing === "new" ? null : editing}
              defaultLayout={defaultLayout}
              saving={save.isPending}
              onSave={(draft) => save.mutate(draft)}
              onCancel={() => setEditing(null)}
              onDelete={
                editing === "new"
                  ? undefined
                  : async () => {
                      if (await confirm({ title: `Delete "${editing.name}"?`, description: "This can't be undone.", confirmText: "Delete play", variant: "destructive" })) {
                        remove.mutate(editing.id);
                      }
                    }
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="relative overflow-hidden w-full max-w-md mx-4 broadcast-stripe">
        <CardContent className="pt-7">
          <div className="flex items-center mb-3 gap-3">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div>
              <div className="eyebrow text-destructive/80">Out of bounds</div>
              <h1 className="page-title text-foreground mt-0.5">404</h1>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            That page isn't on the scoreboard. Check the URL or head back to the dashboard.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

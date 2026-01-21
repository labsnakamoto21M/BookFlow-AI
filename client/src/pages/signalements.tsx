import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AlertTriangle, Ban, Phone, Shield, ShieldOff, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

interface NoShowReport {
  id: string;
  providerId: string;
  phone: string;
  reportedAt: string;
  noShowTotal: number;
  lastNoShowDate: string | null;
}

interface ProviderBlock {
  id: string;
  providerId: string;
  phone: string;
  reason: string | null;
  blockedAt: string;
}

export default function SignalementsPage() {
  const { toast } = useToast();

  const { data: signalements, isLoading: loadingSignalements } = useQuery<NoShowReport[]>({
    queryKey: ["/api/signalements"],
  });

  const { data: blocks, isLoading: loadingBlocks } = useQuery<ProviderBlock[]>({
    queryKey: ["/api/blocks"],
  });

  const blockMutation = useMutation({
    mutationFn: (phone: string) => apiRequest("POST", "/api/blocks", { phone, reason: "No-show répété" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      toast({ title: "Succès", description: "Client bloqué définitivement" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de bloquer ce client", variant: "destructive" });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: (phone: string) => apiRequest("DELETE", `/api/blocks/${encodeURIComponent(phone)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blocks"] });
      toast({ title: "Succès", description: "Client débloqué" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de débloquer ce client", variant: "destructive" });
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return format(parseISO(dateStr), "d MMM yyyy 'à' HH:mm", { locale: fr });
    } catch {
      return dateStr;
    }
  };

  const isBlocked = (phone: string) => {
    return blocks?.some(b => b.phone === phone);
  };

  const uniquePhones = signalements 
    ? Array.from(new Set(signalements.map(s => s.phone))).map(phone => {
        const reports = signalements.filter(s => s.phone === phone);
        const latest = reports.reduce((a, b) => 
          new Date(a.reportedAt) > new Date(b.reportedAt) ? a : b
        );
        return latest;
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-mono" data-testid="text-signalements-title">
          {">"} Signalements No-Show
        </h1>
        <p className="text-muted-foreground font-mono text-sm">
          Clients que vous avez signalés pour RDV non honorés
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="neon-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-mono">Signalements</p>
                <p className="text-3xl font-bold text-primary" data-testid="text-total-signalements">
                  {signalements?.length || 0}
                </p>
              </div>
              <div className="h-12 w-12 rounded-sm bg-primary/10 flex items-center justify-center neon-border">
                <AlertTriangle className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="neon-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-mono">Clients uniques</p>
                <p className="text-3xl font-bold text-primary" data-testid="text-unique-clients">
                  {uniquePhones.length}
                </p>
              </div>
              <div className="h-12 w-12 rounded-sm bg-primary/10 flex items-center justify-center neon-border">
                <Phone className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="neon-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-mono">Bloqués</p>
                <p className="text-3xl font-bold text-destructive" data-testid="text-blocked-count">
                  {blocks?.length || 0}
                </p>
              </div>
              <div className="h-12 w-12 rounded-sm bg-destructive/10 flex items-center justify-center">
                <Ban className="h-6 w-6 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="neon-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono">
            <AlertTriangle className="h-5 w-5 text-primary" />
            Mes signalements
          </CardTitle>
          <CardDescription className="font-mono text-sm">
            Utilisez la commande !noshow dans WhatsApp pour signaler un client
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingSignalements ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-sm" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-8 w-24" />
                </div>
              ))}
            </div>
          ) : uniquePhones.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="empty-state-signalements">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-mono">Aucun signalement</p>
              <p className="text-sm mt-1 font-mono">
                Ecrivez !noshow dans une conversation WhatsApp pour signaler un client
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-primary/30">
                  <TableHead className="font-mono">Téléphone</TableHead>
                  <TableHead className="font-mono">Score</TableHead>
                  <TableHead className="font-mono">Dernier signalement</TableHead>
                  <TableHead className="font-mono">Statut</TableHead>
                  <TableHead className="font-mono text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uniquePhones.map((report) => (
                  <TableRow key={report.phone} className="border-primary/20" data-testid={`row-signalement-${report.phone}`}>
                    <TableCell className="font-mono font-medium">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-primary" />
                        <span data-testid={`text-phone-${report.phone}`}>{report.phone}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={report.noShowTotal >= 3 ? "destructive" : "secondary"}
                        className="font-mono"
                        data-testid={`badge-noshow-${report.phone}`}
                      >
                        {report.noShowTotal} no-show{report.noShowTotal > 1 ? "s" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(report.lastNoShowDate)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {isBlocked(report.phone) ? (
                        <Badge variant="destructive" className="font-mono" data-testid={`badge-status-blocked-${report.phone}`}>
                          <Ban className="h-3 w-3 mr-1" />
                          Bloque
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="font-mono text-primary border-primary/50" data-testid={`badge-status-active-${report.phone}`}>
                          Actif
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isBlocked(report.phone) ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              className="font-mono"
                              data-testid={`button-unblock-${report.phone}`}
                            >
                              <ShieldOff className="h-4 w-4 mr-1" />
                              Débloquer
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="neon-border">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="font-mono">Débloquer ce client ?</AlertDialogTitle>
                              <AlertDialogDescription className="font-mono">
                                Ce client pourra à nouveau vous contacter via WhatsApp.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="font-mono" data-testid={`button-cancel-unblock-${report.phone}`}>Annuler</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => unblockMutation.mutate(report.phone)}
                                className="font-mono"
                                data-testid={`button-confirm-unblock-${report.phone}`}
                              >
                                Débloquer
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="destructive" 
                              size="sm"
                              className="font-mono"
                              data-testid={`button-block-${report.phone}`}
                            >
                              <Ban className="h-4 w-4 mr-1" />
                              Bloquer
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="neon-border">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="font-mono">Bloquer définitivement ?</AlertDialogTitle>
                              <AlertDialogDescription className="font-mono">
                                Ce client ne pourra plus vous contacter via WhatsApp. 
                                Cette action est réversible.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="font-mono" data-testid={`button-cancel-block-${report.phone}`}>Annuler</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => blockMutation.mutate(report.phone)}
                                className="bg-destructive text-destructive-foreground font-mono"
                                data-testid={`button-confirm-block-${report.phone}`}
                              >
                                Bloquer
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {blocks && blocks.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-destructive">
              <Ban className="h-5 w-5" />
              Clients bloqués ({blocks.length})
            </CardTitle>
            <CardDescription className="font-mono text-sm">
              Ces clients ne peuvent plus vous contacter
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingBlocks ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {blocks.map((block) => (
                  <Badge 
                    key={block.id} 
                    variant="destructive" 
                    className="font-mono text-sm py-1 px-3"
                  >
                    <Phone className="h-3 w-3 mr-1" />
                    {block.phone}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

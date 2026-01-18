import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, ShieldBan, Phone, AlertTriangle, Users } from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import type { BlacklistEntry } from "@shared/schema";

const blacklistFormSchema = z.object({
  phone: z.string().min(1, "Le numéro est requis").regex(/^\+?[0-9\s-]{8,}$/, "Format invalide"),
  reason: z.string().optional(),
});

type BlacklistFormValues = z.infer<typeof blacklistFormSchema>;

export default function BlacklistPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: blacklist, isLoading } = useQuery<BlacklistEntry[]>({
    queryKey: ["/api/blacklist"],
  });

  const form = useForm<BlacklistFormValues>({
    resolver: zodResolver(blacklistFormSchema),
    defaultValues: {
      phone: "",
      reason: "",
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: BlacklistFormValues) => apiRequest("POST", "/api/blacklist", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blacklist"] });
      toast({ title: "Succès", description: "Numéro ajouté à la blacklist" });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible d'ajouter le numéro", variant: "destructive" });
    },
  });

  const onSubmit = (data: BlacklistFormValues) => {
    addMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-blacklist-title">Blacklist partagée</h1>
          <p className="text-muted-foreground">
            Liste des numéros signalés par la communauté des prestataires
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-blacklist">
              <Plus className="h-4 w-4 mr-2" />
              Signaler un numéro
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Signaler un numéro</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Numéro de téléphone</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="+33 6 12 34 56 78" 
                          {...field} 
                          data-testid="input-blacklist-phone"
                        />
                      </FormControl>
                      <FormDescription>
                        Format international recommandé
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Raison (optionnel)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="ex: No-show répétés, comportement inapproprié..." 
                          {...field} 
                          data-testid="input-blacklist-reason"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                  >
                    Annuler
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={addMutation.isPending}
                    data-testid="button-confirm-blacklist"
                  >
                    {addMutation.isPending ? "Signalement..." : "Signaler"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Info Card */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10">
        <CardContent className="p-6">
          <div className="flex gap-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-amber-800 dark:text-amber-200">Fonctionnement de la blacklist</p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Cette liste est partagée entre tous les prestataires. Quand un client blacklisté tente de réserver, 
                le bot vous en informe discrètement. Vous pouvez choisir d'accepter ou refuser la réservation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <ShieldBan className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-blacklist-count">
                  {isLoading ? "..." : blacklist?.length ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">Numéros blacklistés</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">Partagée</p>
                <p className="text-sm text-muted-foreground">Entre tous les prestataires</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Phone className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">Protection</p>
                <p className="text-sm text-muted-foreground">Contre les no-shows</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Blacklist Table */}
      <Card>
        <CardHeader>
          <CardTitle>Liste des numéros signalés</CardTitle>
          <CardDescription>
            Ces numéros ont été signalés par d'autres prestataires
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48 flex-1" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          ) : blacklist && blacklist.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numéro</TableHead>
                  <TableHead>Raison</TableHead>
                  <TableHead>Signalements</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blacklist.map((entry) => (
                  <TableRow key={entry.id} data-testid={`blacklist-${entry.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        {entry.phone}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {entry.reason || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.reportCount && entry.reportCount > 2 ? "destructive" : "secondary"}>
                        {entry.reportCount} signalement{entry.reportCount && entry.reportCount > 1 ? "s" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.createdAt && format(
                        typeof entry.createdAt === 'string' ? parseISO(entry.createdAt) : entry.createdAt,
                        "d MMM yyyy",
                        { locale: fr }
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldBan className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Aucun numéro dans la blacklist</p>
              <p className="text-sm mt-1">Les numéros signalés apparaîtront ici</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

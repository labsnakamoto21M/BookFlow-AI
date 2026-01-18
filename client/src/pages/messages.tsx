import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, ArrowDownLeft, ArrowUpRight, Phone } from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import type { MessageLogEntry } from "@shared/schema";

export default function MessagesPage() {
  const { data: messages, isLoading } = useQuery<MessageLogEntry[]>({
    queryKey: ["/api/messages"],
  });

  const groupedMessages = messages?.reduce((acc, msg) => {
    if (!acc[msg.clientPhone]) {
      acc[msg.clientPhone] = [];
    }
    acc[msg.clientPhone].push(msg);
    return acc;
  }, {} as Record<string, MessageLogEntry[]>);

  const conversations = groupedMessages
    ? Object.entries(groupedMessages).map(([phone, msgs]) => ({
        phone,
        messages: msgs.sort((a, b) => 
          new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
        ),
        lastMessage: msgs[msgs.length - 1],
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-messages-title">Messages</h1>
        <p className="text-muted-foreground">
          Historique des conversations WhatsApp avec vos clients
        </p>
      </div>

      {/* Conversations */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Conversation List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Conversations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
              {isLoading ? (
                <div className="p-4 space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : conversations.length > 0 ? (
                <div className="divide-y">
                  {conversations.map((conv) => (
                    <div
                      key={conv.phone}
                      className="p-4 hover-elevate cursor-pointer"
                      data-testid={`conversation-${conv.phone}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Phone className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{conv.phone}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.lastMessage.content}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {conv.messages.length}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Aucune conversation</p>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Recent Messages */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Messages récents</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
              {isLoading ? (
                <div className="p-4 space-y-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                        <Skeleton className="h-12 w-full rounded-lg" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : messages && messages.length > 0 ? (
                <div className="p-4 space-y-4">
                  {messages.slice().reverse().slice(0, 50).map((msg) => {
                    const createdAt = msg.createdAt 
                      ? (typeof msg.createdAt === 'string' ? parseISO(msg.createdAt) : msg.createdAt)
                      : new Date();
                    const isIncoming = msg.direction === "incoming";
                    
                    return (
                      <div 
                        key={msg.id} 
                        className="flex gap-3"
                        data-testid={`message-${msg.id}`}
                      >
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isIncoming ? "bg-muted" : "bg-primary/10"
                        }`}>
                          {isIncoming ? (
                            <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">
                              {isIncoming ? msg.clientPhone : "Bot"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {format(createdAt, "d MMM HH:mm", { locale: fr })}
                            </span>
                          </div>
                          <div className={`rounded-lg p-3 text-sm ${
                            isIncoming 
                              ? "bg-muted" 
                              : "bg-primary text-primary-foreground"
                          }`}>
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Aucun message</p>
                  <p className="text-sm mt-1">Les messages apparaîtront ici une fois le bot connecté</p>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

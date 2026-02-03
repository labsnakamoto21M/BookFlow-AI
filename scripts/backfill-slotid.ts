/**
 * Backfill Script: SlotId Migration (V1 Strict)
 * 
 * This script backfills slotId for tables that previously had nullable slotId.
 * 
 * Tables affected:
 * - appointments
 * - business_hours
 * - base_prices
 * - service_extras (new column)
 * - custom_extras (new column)
 * - blocked_slots (new column)
 * - conversation_sessions (new column)
 * 
 * Strategy:
 * 1. For each provider with null slotId rows:
 *    - If provider has exactly 1 slot: auto-assign that slot.id to all null rows
 *    - If provider has 0 slots or >1 slots: ABORT with clear error listing providerId + table + count
 * 
 * Run with: npx tsx scripts/backfill-slotid.ts
 */

import { db } from "../server/db";
import { 
  slots, 
  appointments, 
  businessHours, 
  basePrices, 
  serviceExtras, 
  customExtras, 
  blockedSlots, 
  conversationSessions 
} from "../shared/schema";
import { eq, isNull, sql } from "drizzle-orm";

interface ConflictReport {
  providerId: string;
  table: string;
  count: number;
  reason: string;
}

async function getProviderSlots(providerId: string) {
  return db.select().from(slots).where(eq(slots.providerId, providerId));
}

async function backfillTable(
  tableName: string,
  table: any,
  conflicts: ConflictReport[]
): Promise<number> {
  let totalUpdated = 0;
  
  // Find all rows with null slotId, grouped by providerId
  const nullRows = await db.select({
    providerId: table.providerId,
    count: sql<number>`count(*)::int`
  })
  .from(table)
  .where(isNull(table.slotId))
  .groupBy(table.providerId);
  
  if (nullRows.length === 0) {
    console.log(`[${tableName}] No null slotId rows found. ✓`);
    return 0;
  }
  
  console.log(`[${tableName}] Found ${nullRows.length} providers with null slotId rows`);
  
  for (const row of nullRows) {
    const providerSlots = await getProviderSlots(row.providerId);
    
    if (providerSlots.length === 0) {
      conflicts.push({
        providerId: row.providerId,
        table: tableName,
        count: row.count,
        reason: "Provider has 0 slots - cannot assign slotId"
      });
      continue;
    }
    
    if (providerSlots.length > 1) {
      conflicts.push({
        providerId: row.providerId,
        table: tableName,
        count: row.count,
        reason: `Provider has ${providerSlots.length} slots - cannot auto-assign, need manual resolution`
      });
      continue;
    }
    
    // Provider has exactly 1 slot - safe to auto-assign
    const slotId = providerSlots[0].id;
    const result = await db.update(table)
      .set({ slotId })
      .where(eq(table.providerId, row.providerId));
    
    console.log(`[${tableName}] Updated ${row.count} rows for provider ${row.providerId} → slotId: ${slotId}`);
    totalUpdated += row.count;
  }
  
  return totalUpdated;
}

async function main() {
  console.log("=".repeat(60));
  console.log("SlotId Backfill Script (V1 Strict)");
  console.log("=".repeat(60));
  console.log("");
  
  const conflicts: ConflictReport[] = [];
  let totalUpdated = 0;
  
  // Backfill each table
  const tables = [
    { name: "appointments", table: appointments },
    { name: "business_hours", table: businessHours },
    { name: "base_prices", table: basePrices },
    { name: "service_extras", table: serviceExtras },
    { name: "custom_extras", table: customExtras },
    { name: "blocked_slots", table: blockedSlots },
    { name: "conversation_sessions", table: conversationSessions },
  ];
  
  for (const { name, table } of tables) {
    try {
      const updated = await backfillTable(name, table, conflicts);
      totalUpdated += updated;
    } catch (error: any) {
      // If table doesn't have slotId column yet, skip (will be added by db:push)
      if (error.message?.includes("column") && error.message?.includes("does not exist")) {
        console.log(`[${name}] Column slotId doesn't exist yet - will be added by db:push`);
      } else {
        throw error;
      }
    }
  }
  
  console.log("");
  console.log("=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`Total rows updated: ${totalUpdated}`);
  
  if (conflicts.length > 0) {
    console.log("");
    console.log("❌ BLOCKING CONFLICTS FOUND:");
    console.log("-".repeat(60));
    for (const c of conflicts) {
      console.log(`  Provider: ${c.providerId}`);
      console.log(`  Table: ${c.table}`);
      console.log(`  Affected rows: ${c.count}`);
      console.log(`  Reason: ${c.reason}`);
      console.log("");
    }
    console.log("MIGRATION ABORTED: Resolve conflicts manually before running db:push");
    console.log("For multi-slot providers, manually assign slotId to each row.");
    process.exit(1);
  }
  
  console.log("");
  console.log("✓ All null slotId values backfilled successfully!");
  console.log("You can now run: npm run db:push");
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

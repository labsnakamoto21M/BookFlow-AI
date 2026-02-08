export const SUBSCRIPTION_PLANS = {
  solo: {
    name: "Solo (1 WhatsApp number)",
    shortName: "SOLO",
    price: 5900, // 59 EUR in cents
    slots: 1,
    priceId: process.env.STRIPE_PRICE_SOLO || process.env.STRIPE_PRICE_ID,
  },
  duo: {
    name: "Duo (2)",
    shortName: "DUO",
    price: 9900, // 99 EUR in cents
    slots: 2,
    priceId: process.env.STRIPE_PRICE_DUO,
  },
  trio: {
    name: "Trio (3)",
    shortName: "TRIO",
    price: 12900, // 129 EUR in cents
    slots: 3,
    priceId: process.env.STRIPE_PRICE_TRIO,
  },
  hexa: {
    name: "Hexa (6)",
    shortName: "HEXA",
    price: 19900, // 199 EUR in cents
    slots: 6,
    priceId: process.env.STRIPE_PRICE_HEXA,
  },
  agency: {
    name: "Agency (15)",
    shortName: "AGENCY",
    price: 29900, // 299 EUR in cents
    slots: 15,
    priceId: process.env.STRIPE_PRICE_AGENCY,
  },
} as const;

export type SubscriptionPlanKey = keyof typeof SUBSCRIPTION_PLANS;

export function getMaxSlotsByPlan(plan: string): number {
  const planConfig = SUBSCRIPTION_PLANS[plan as SubscriptionPlanKey];
  return planConfig?.slots || 1;
}

export function getPlanByPriceId(priceId: string): SubscriptionPlanKey | null {
  for (const [key, plan] of Object.entries(SUBSCRIPTION_PLANS)) {
    if (plan.priceId === priceId) {
      return key as SubscriptionPlanKey;
    }
  }
  return null;
}

export function getPriceIdForPlan(plan: string): string | undefined {
  const planConfig = SUBSCRIPTION_PLANS[plan as SubscriptionPlanKey];
  return planConfig?.priceId;
}

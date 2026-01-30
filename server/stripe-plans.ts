export const SUBSCRIPTION_PLANS = {
  solo: {
    name: "SOLO",
    price: 4900, // 49 EUR in cents
    slots: 1,
    priceId: process.env.STRIPE_PRICE_SOLO || process.env.STRIPE_PRICE_ID,
  },
  duo: {
    name: "DUO",
    price: 7900, // 79 EUR in cents
    slots: 2,
    priceId: process.env.STRIPE_PRICE_DUO,
  },
  trio: {
    name: "TRIO",
    price: 9900, // 99 EUR in cents
    slots: 3,
    priceId: process.env.STRIPE_PRICE_TRIO,
  },
  elite: {
    name: "ELITE",
    price: 14900, // 149 EUR in cents
    slots: 6,
    priceId: process.env.STRIPE_PRICE_ELITE,
  },
  agence: {
    name: "AGENCE",
    price: 22900, // 229 EUR in cents
    slots: 15,
    priceId: process.env.STRIPE_PRICE_AGENCE,
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

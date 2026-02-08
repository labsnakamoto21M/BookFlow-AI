import { getStripeSync } from './stripeClient';
import { storage } from './storage';
import { getPlanByPriceId, getMaxSlotsByPlan } from './stripe-plans';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    try {
      const event = JSON.parse(payload.toString());
      
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerId = session.customer;
        const providerId = session.metadata?.providerId;
        const planName = session.metadata?.plan || 'solo';
        const maxSlots = parseInt(session.metadata?.maxSlots || '1', 10);
        
        if (providerId) {
          await storage.updateProviderProfile(providerId, {
            subscriptionStatus: 'active',
            stripeCustomerId: customerId,
            maxSlots: maxSlots,
          });
          
          const profile = await storage.getProviderProfileById(providerId);
          if (profile) {
            await storage.updateUserSubscriptionPlan(profile.userId, planName);
          }
          
          console.log(`[Stripe Webhook] Checkout completed - provider ${providerId}, plan=${planName}, maxSlots=${maxSlots}`);
        } else if (customerId) {
          const profile = await storage.getProviderProfileByStripeCustomerId(customerId);
          if (profile) {
            await storage.updateProviderProfile(profile.id, {
              subscriptionStatus: 'active',
              maxSlots: maxSlots,
            });
            await storage.updateUserSubscriptionPlan(profile.userId, planName);
            console.log(`[Stripe Webhook] Checkout completed - customer ${customerId}, plan=${planName}, maxSlots=${maxSlots}`);
          }
        }
      }
      
      if (event.type === 'customer.subscription.deleted' || 
          event.type === 'customer.subscription.updated') {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        
        const profile = await storage.getProviderProfileByStripeCustomerId(customerId);
        if (profile) {
          const isActive = subscription.status === 'active' || subscription.status === 'trialing';
          
          const updateData: any = {
            subscriptionStatus: isActive ? 'active' : 'cancelled',
          };

          const priceId = subscription.items?.data?.[0]?.price?.id;
          if (priceId && isActive) {
            const detectedPlan = getPlanByPriceId(priceId);
            if (detectedPlan) {
              const detectedMaxSlots = getMaxSlotsByPlan(detectedPlan);
              updateData.maxSlots = detectedMaxSlots;
              await storage.updateUserSubscriptionPlan(profile.userId, detectedPlan);
              console.log(`[Stripe Webhook] Subscription updated for ${customerId}: plan=${detectedPlan}, maxSlots=${detectedMaxSlots}`);
            }
          } else if (!isActive) {
            updateData.maxSlots = 0;
            await storage.updateUserSubscriptionPlan(profile.userId, 'solo');
            console.log(`[Stripe Webhook] Subscription cancelled/expired for ${customerId}: maxSlots=0, plan=solo`);
          }

          await storage.updateProviderProfile(profile.id, updateData);
          console.log(`[Stripe Webhook] Updated subscription status for ${customerId}: ${isActive ? 'active' : 'cancelled'}`);
        }
      }

      if (event.type === 'invoice.payment_failed') {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        
        const profile = await storage.getProviderProfileByStripeCustomerId(customerId);
        if (profile) {
          console.log(`[Stripe Webhook] Payment failed for customer ${customerId}`);
        }
      }
    } catch (error) {
      console.error('[Stripe Webhook] Error processing subscription event:', error);
    }
  }
}

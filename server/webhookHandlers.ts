import { getStripeSync } from './stripeClient';
import { storage } from './storage';

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
        
        if (providerId) {
          await storage.updateProviderProfile(providerId, {
            subscriptionStatus: 'active',
            stripeCustomerId: customerId,
          });
          console.log(`[Stripe Webhook] Checkout completed - activated subscription for provider ${providerId}`);
        } else if (customerId) {
          const profile = await storage.getProviderProfileByStripeCustomerId(customerId);
          if (profile) {
            await storage.updateProviderProfile(profile.id, {
              subscriptionStatus: 'active',
            });
            console.log(`[Stripe Webhook] Checkout completed - activated subscription for customer ${customerId}`);
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
          await storage.updateProviderProfile(profile.id, {
            subscriptionStatus: isActive ? 'active' : 'cancelled'
          });
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

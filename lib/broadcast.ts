// A global singleton BroadcastChannel with typed events
export type BroadcastMessage = {
  type: 'created' | 'updated' | 'deleted' | 'refresh' | 'logout';
  resource: string; // 'customers', 'vendors', 'products', 'sales', etc.
  id?: string | number; // Optional ID for specific records
  data?: any; // Optional additional data
};

let bc: BroadcastChannel | null = null;

export const getBroadcastChannel = () => {
  if (!bc) bc = new BroadcastChannel('global_sync');
  return bc;
};

/** Send a typed broadcast message */
export const broadcast = (msg: BroadcastMessage) => {
  const ch = getBroadcastChannel();
  ch.postMessage(msg);
};

/** Subscribe to typed broadcast messages */
export const subscribeBroadcast = (handler: (msg: BroadcastMessage) => void) => {
  const ch = getBroadcastChannel();

  const listener = (event: MessageEvent) => handler(event.data);
  ch.addEventListener('message', listener);

  // cleanup helper
  return () => ch.removeEventListener('message', listener);
};

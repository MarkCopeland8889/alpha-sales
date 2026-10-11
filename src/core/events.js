// In-process event bus. The server forwards every event to the UI over WebSocket,
// so anything emitted here shows up live in the control panel.
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

// emit('log', {...}), emit('session.opened', {...}), emit('hitl.request', {...}) ...
export function emit(type, data = {}) {
  bus.emit('event', { type, data, at: new Date().toISOString() });
}

export function onEvent(fn) {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}

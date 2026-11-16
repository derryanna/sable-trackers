import { createPanel } from './src/ui/panel.js';
import { createRuntime } from './src/run.js';
import { createDrawer } from './src/ui/drawer.js';
import { createSettings } from './src/ui/settings.js';
import { createAltTurn } from './src/ui/altturn.js';

export let runtime;
export let drawer;
export let panel;
export let settings;
export let altTurn;
export function initialize() {
  if (!runtime && globalThis.SillyTavern?.getContext) {
    runtime = createRuntime();
    runtime.start();
    if (globalThis.document?.body) {
      altTurn = createAltTurn(runtime);
      settings = createSettings(runtime, { altTurnSent: () => altTurn.showLast() });
      drawer = createDrawer(runtime);
      panel = createPanel(runtime, drawer);
    }
  }
  return runtime;
}

if (typeof globalThis.$ === 'function') globalThis.$(initialize);
else initialize();

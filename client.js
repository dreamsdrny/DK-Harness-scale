/**
 * Wheel zoom for the conversation area.
 *
 * Only the conversation transcript is scaled: a fixed CSS `zoom` on its scroll
 * container multiplies the absolute lengths inside it — type, padding, icons,
 * controls — while percentage-sized boxes keep the width the layout gave them,
 * so the chat reflows inside its column instead of overflowing it. The sidebar,
 * the header, the composer and the rest of the shell stay at 100%.
 *
 * The transcript is located by geometry (the largest scrollable box in the
 * middle band of the window), so no host class name is hard-coded and the
 * navigation rail on the left can never be picked. A zero-size anchor rendered
 * in the composer dock is the last-resort target while nothing scrolls yet.
 *
 * Triggers:
 *  - Ctrl (or Cmd) + wheel anywhere in the page;
 *  - plain wheel while the pointer is over the corner pill;
 *  - the pill buttons, and clicking the percentage to return to 100%.
 */
window.__ModuleLoader__.load({
  id: '@local/ui-wheel-zoom',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'ui-wheel-zoom';
    const STORAGE_KEY = 'dsh.ui-wheel-zoom.factor';
    const MIN = 0.5;
    const MAX = 2;
    const DEFAULT = 1;
    /** Exponential rate: a ~100px wheel notch is about one 10% step. */
    const WHEEL_RATE = 0.0012;
    const ANCHOR = 'data-ui-wheel-zoom-anchor';

    const EN = {
      label: 'Conversation zoom',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      reset: 'Reset to 100%',
      value: 'Current zoom',
      hint: 'Ctrl + scroll to zoom the conversation area. You can also scroll over this control, use its buttons, or click the percentage to reset.',
    };
    const ZH = {
      label: '对话缩放',
      zoomIn: '放大',
      zoomOut: '缩小',
      reset: '恢复到 100%',
      value: '当前缩放',
      hint: '按住 Ctrl 再滚动滚轮即可缩放对话区域；也可以直接在本控件上滚动、点加减号，或点百分比恢复 100%。',
    };

    // ------------------------------------------------------------------
    // Zoom state
    // ------------------------------------------------------------------

    let factor = DEFAULT;
    let exact = DEFAULT;
    /** The element `zoom` is applied to: the conversation transcript. */
    let panel = null;
    /** The factor the box was pinned for when the zoom would spill. */
    let fittedFor = 0;
    const subscribers = new Set();

    function clamp(value) {
      return Math.min(MAX, Math.max(MIN, value));
    }

    function round2(value) {
      return Math.round(value * 100) / 100;
    }

    function readStored() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return DEFAULT;
        const value = Number(raw);
        if (!Number.isFinite(value)) return DEFAULT;
        return round2(clamp(value));
      } catch {
        return DEFAULT;
      }
    }

    function persist(value) {
      try {
        if (value === DEFAULT) window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, String(value));
      } catch {
        /* storage can be unavailable; zoom still works for this page life */
      }
    }

    // ------------------------------------------------------------------
    // Locating the conversation panel
    // ------------------------------------------------------------------

    const SCROLLABLE = new Set(['auto', 'scroll', 'overlay']);

    /**
     * The transcript: the largest scrollable box in the middle band of the
     * window. It is located by geometry alone, not from the composer dock: the
     * composer bar is not guaranteed to live inside the conversation column (a
     * shell-level bottom bar would make the nearest common frame a frame that
     * also owns the sidebar, which must never scale). The left band is the
     * navigation rail, so a box starting there is never the conversation.
     */
    function findTranscript() {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const leftLimit = windowWidth * 0.04;
      const minHeight = Math.min(320, windowHeight * 0.35);
      let best = null;
      let bestArea = 0;
      for (const element of document.querySelectorAll('*')) {
        if (element === document.body || element === document.documentElement) continue;
        if (element.clientHeight < minHeight) continue;
        if (element.clientWidth < windowWidth * 0.3) continue;
        if (!SCROLLABLE.has(getComputedStyle(element).overflowY)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.left < leftLimit) continue;
        // The conversation sits between the rails, so its centre is close to
        // the window centre; a list hanging off the sidebar is not.
        if (Math.abs(rect.left + rect.width / 2 - windowWidth / 2) > windowWidth * 0.35) continue;
        const area = rect.width * rect.height;
        if (area <= bestArea) continue;
        bestArea = area;
        best = element;
      }
      return best;
    }

    /**
     * Last resort while nothing scrolls yet (an empty conversation): the
     * nearest ancestor of the composer anchor that is not the whole frame. The
     * left and width bounds keep a frame that also owns the sidebar out.
     */
    function findFrameFromAnchor() {
      const anchor = document.querySelector(`[${ANCHOR}]`);
      if (!anchor) return null;
      const windowWidth = window.innerWidth;
      let element = anchor.parentElement;
      while (element && element !== document.body) {
        const rect = element.getBoundingClientRect();
        if (
          rect.width >= 240 &&
          rect.height >= 240 &&
          rect.left > windowWidth * 0.04 &&
          rect.width < windowWidth * 0.92
        ) {
          return element;
        }
        element = element.parentElement;
      }
      return null;
    }

    function resolveTarget() {
      return findTranscript() || findFrameFromAnchor();
    }

    /** Apply the factor; 100% removes every property this plugin added. */
    function paint(value) {
      if (!panel || !panel.isConnected) {
        panel = resolveTarget();
        fittedFor = 0;
      }
      if (!panel) return;
      if (fittedFor !== 0) {
        panel.style.removeProperty('width');
        panel.style.removeProperty('height');
        panel.style.removeProperty('flex');
        fittedFor = 0;
      }
      if (value === DEFAULT) {
        panel.style.removeProperty('zoom');
        return;
      }
      panel.style.zoom = String(value);
      fit(value);
    }

    /**
     * A zoomed box normally keeps the size its layout gave it, so the chat only
     * reflows. If this Chromium instead multiplies the box itself, the box
     * would spill out of its column; pin it to the column then.
     */
    function fit(value) {
      const parent = panel && panel.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const rect = panel.getBoundingClientRect();
      if (rect.width <= parentRect.width + 8 && rect.height <= parentRect.height + 8) return;
      panel.style.flex = '0 0 auto';
      panel.style.width = `${Math.max(120, Math.floor(parentRect.width / value))}px`;
      panel.style.height = `${Math.max(120, Math.floor(parentRect.height / value))}px`;
      fittedFor = value;
    }

    function release() {
      if (!panel) return;
      panel.style.removeProperty('zoom');
      panel.style.removeProperty('width');
      panel.style.removeProperty('height');
      panel.style.removeProperty('flex');
      fittedFor = 0;
    }

    function commit(next, save) {
      const value = round2(clamp(next));
      const changed = value !== factor;
      exact = clamp(next);
      factor = value;
      if (!changed) return;
      paint(value);
      if (save) persist(value);
      for (const notify of subscribers) notify();
    }

    function subscribe(notify) {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    }

    function snapshot() {
      return factor;
    }

    // ------------------------------------------------------------------
    // Input
    // ------------------------------------------------------------------

    function deltaOf(event) {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      return event.deltaY * unit;
    }

    /** Zoom by one wheel sample. Returns false when the sample carries no delta. */
    function zoomByWheel(event) {
      const delta = deltaOf(event);
      if (!Number.isFinite(delta) || delta === 0) return false;
      commit(exact * Math.exp(-delta * WHEEL_RATE), true);
      return true;
    }

    function onWindowWheel(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      // A control that already handled this chord (a terminal font zoom, say)
      // keeps it.
      if (event.defaultPrevented) return;
      if (!zoomByWheel(event)) return;
      event.preventDefault();
    }

    // ------------------------------------------------------------------
    // Locale
    // ------------------------------------------------------------------

    let localeFace = null;

    function bindLocale(ctx) {
      const locale = ctx.get('locale');
      if (!locale || typeof locale.register !== 'function') return () => {};

      const disposers = [];
      for (const [id, dict] of [
        ['en', EN],
        ['zh', ZH],
      ]) {
        try {
          disposers.push(locale.register(NS, id, dict));
        } catch (error) {
          console.error('[ui-wheel-zoom] dictionary registration failed', error);
        }
      }

      localeFace = {
        getSnapshot: () => locale.getSnapshot(),
        subscribe: (fn) => locale.subscribe(fn),
        translate: (key) => {
          try {
            return locale.bind(NS)(key) || EN[key] || key;
          } catch {
            return EN[key] || key;
          }
        },
      };

      return () => {
        localeFace = null;
        for (const dispose of disposers) {
          try {
            dispose();
          } catch (error) {
            console.error('[ui-wheel-zoom] dictionary disposal failed', error);
          }
        }
      };
    }

    function emptySubscribe() {
      return () => {};
    }

    function emptySnapshot() {
      return 0;
    }

    /** Copy for the current locale, re-read on every locale revision. */
    function useCopy() {
      const face = localeFace;
      React.useSyncExternalStore(
        face ? face.subscribe : emptySubscribe,
        face ? face.getSnapshot : emptySnapshot,
      );
      if (!face) {
        return {
          label: EN.label,
          zoomIn: EN.zoomIn,
          zoomOut: EN.zoomOut,
          reset: EN.reset,
          value: EN.value,
          hint: EN.hint,
        };
      }
      const t = face.translate;
      return {
        label: t('label'),
        zoomIn: t('zoomIn'),
        zoomOut: t('zoomOut'),
        reset: t('reset'),
        value: t('value'),
        hint: t('hint'),
      };
    }

    // ------------------------------------------------------------------
    // Anchor inside the conversation
    // ------------------------------------------------------------------

    function Anchor() {
      React.useEffect(() => {
        // The anchor is committed: re-resolve and re-apply the saved factor to
        // the conversation panel that now exists.
        paint(factor);
      }, []);
      return h('span', {
        [ANCHOR]: '',
        'aria-hidden': 'true',
        style: {
          display: 'block',
          width: 0,
          height: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        },
      });
    }

    // ------------------------------------------------------------------
    // Pill
    // ------------------------------------------------------------------

    const CSS = `
.uz-wheel-zoom {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 1px;
  box-sizing: border-box;
  padding: 3px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  opacity: 0.68;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity 140ms ease;
}
.uz-wheel-zoom:hover,
.uz-wheel-zoom:focus-within {
  opacity: 1;
}
.uz-wheel-zoom__icon {
  flex: none;
  margin: 0 3px 0 5px;
  color: var(--dsw-alias-label-secondary);
}
.uz-wheel-zoom__button {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.uz-wheel-zoom__button:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
}
.uz-wheel-zoom__button:disabled {
  opacity: 0.35;
  cursor: default;
}
.uz-wheel-zoom__value {
  flex: none;
  min-width: 46px;
  height: 24px;
  margin: 0;
  padding: 0 6px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.uz-wheel-zoom__value:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
}
`;

    const MINUS = h(
      'svg',
      { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true, focusable: 'false' },
      h('path', {
        d: 'M3.5 8h9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
      }),
    );

    const PLUS = h(
      'svg',
      { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true, focusable: 'false' },
      h('path', {
        d: 'M3.5 8h9M8 3.5v9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
      }),
    );

    const MAGNIFIER = h(
      'svg',
      {
        className: 'uz-wheel-zoom__icon',
        viewBox: '0 0 16 16',
        width: 13,
        height: 13,
        'aria-hidden': true,
        focusable: 'false',
      },
      h('circle', {
        cx: 7,
        cy: 7,
        r: 4.1,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
      }),
      h('path', {
        d: 'M10.1 10.1 13.3 13.3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
      }),
    );

    function ZoomPill() {
      const copy = useCopy();
      const value = React.useSyncExternalStore(subscribe, snapshot, snapshot);
      const pill = React.useRef(null);

      React.useEffect(() => {
        const element = pill.current;
        if (!element) return undefined;
        const onWheel = (event) => {
          // Ctrl/Cmd + wheel is the window handler's chord; avoid a double step.
          if (event.ctrlKey || event.metaKey) return;
          if (!zoomByWheel(event)) return;
          event.preventDefault();
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
      }, []);

      const percent = Math.round(value * 100);
      const canOut = value > MIN + 0.0001;
      const canIn = value < MAX - 0.0001;

      return h(
        React.Fragment,
        null,
        h('style', { key: 'style', 'data-ui-wheel-zoom': '' }, CSS),
        h(
          'div',
          {
            key: 'pill',
            ref: pill,
            className: 'uz-wheel-zoom',
            role: 'group',
            'aria-label': copy.label,
            title: copy.hint,
          },
          MAGNIFIER,
          h(
            'button',
            {
              type: 'button',
              className: 'uz-wheel-zoom__button',
              title: copy.zoomOut,
              'aria-label': copy.zoomOut,
              disabled: !canOut,
              onClick: () => commit(value - 0.1, true),
            },
            MINUS,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'uz-wheel-zoom__value',
              title: copy.reset,
              'aria-label': `${copy.value}: ${percent}%. ${copy.reset}`,
              onClick: () => commit(DEFAULT, true),
            },
            `${percent}%`,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'uz-wheel-zoom__button',
              title: copy.zoomIn,
              'aria-label': copy.zoomIn,
              disabled: !canIn,
              onClick: () => commit(value + 0.1, true),
            },
            PLUS,
          ),
        ),
      );
    }

    // ------------------------------------------------------------------
    // Plugin
    // ------------------------------------------------------------------

    function apply(ctx) {
      // Restore the saved factor as soon as a conversation panel exists.
      commit(readStored(), false);

      ctx.effect(() => {
        window.addEventListener('wheel', onWindowWheel, { passive: false });
        // The conversation panel is remounted on Session switches and panel
        // navigation; re-resolve only when the pinned element left the DOM.
        const retry = window.setInterval(() => {
          if (!panel || !panel.isConnected) paint(factor);
        }, 1200);
        return () => {
          window.removeEventListener('wheel', onWindowWheel);
          window.clearInterval(retry);
          release();
          panel = null;
        };
      }, 'ui-wheel-zoom: conversation wheel zoom');

      ctx.effect(() => bindLocale(ctx), 'ui-wheel-zoom: dictionaries');

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'ui-wheel-zoom-anchor',
            order: 0,
          },
          Anchor,
        ),
      );

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'ui-wheel-zoom',
            order: 61,
          },
          ZoomPill,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply,
    };
  },
});

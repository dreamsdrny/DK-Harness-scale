/**
 * Wheel zoom for the conversation area.
 *
 * Only the conversation body (transcript + composer) is scaled: a fixed CSS
 * `zoom` on that panel multiplies its absolute lengths — type, padding, icons,
 * controls — while percentage-sized boxes keep the width the layout gave them,
 * so the chat reflows inside its column instead of overflowing it. The sidebar,
 * the header and the rest of the shell stay at 100%.
 *
 * The panel is located from a zero-size anchor this plugin renders in the
 * composer dock, so no host class name is hard-coded: the transcript is the
 * large scroll container above that anchor, and the panel is the nearest
 * ancestor that contains it.
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
    let panel = null;
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

    /**
     * The transcript scroller: the largest scrollable box that ends above the
     * anchor and shares its column. The column test (same horizontal centre,
     * most of the window width) is what keeps the sidebar's session and
     * workspace lists out: they end above the dock too, but they sit at the
     * left edge of the window. A short transcript does not overflow yet, so the
     * tallest non-overflowing box wins when nothing scrolls.
     */
    function findTranscript(anchor) {
      const anchorRect = anchor.getBoundingClientRect();
      const anchorCentre = anchorRect.left + anchorRect.width / 2;
      const windowWidth = window.innerWidth;
      let overflowing = null;
      let overflowingArea = 0;
      let tallest = null;
      let tallestArea = 0;
      for (const element of document.querySelectorAll('*')) {
        if (element === anchor || element.contains(anchor)) continue;
        if (element.clientHeight < 160 || element.clientWidth < 240) continue;
        const overflow = getComputedStyle(element).overflowY;
        if (overflow !== 'auto' && overflow !== 'scroll') continue;
        const rect = element.getBoundingClientRect();
        if (rect.bottom > anchorRect.top + 12) continue;
        if (rect.width < windowWidth * 0.3) continue;
        if (Math.abs(rect.left + rect.width / 2 - anchorCentre) > windowWidth * 0.3) continue;
        const size = rect.width * rect.height;
        if (element.scrollHeight > element.clientHeight + 8) {
          if (size > overflowingArea) {
            overflowingArea = size;
            overflowing = element;
          }
        } else if (size > tallestArea) {
          tallestArea = size;
          tallest = element;
        }
      }
      return overflowing || tallest;
    }

    /** The nearest ancestor of the anchor that also contains the transcript. */
    function findPanel(anchor, transcript) {
      const transcriptRect = transcript.getBoundingClientRect();
      let element = anchor.parentElement;
      while (element && element !== document.body) {
        if (element.contains(transcript)) {
          const rect = element.getBoundingClientRect();
          if (rect.width < 240 || rect.height < 240) return null;
          // A frame that starts far left of the transcript also owns the
          // sidebar; refuse it rather than scaling the navigation.
          if (Math.abs(rect.left - transcriptRect.left) > 160) return null;
          return element;
        }
        element = element.parentElement;
      }
      return null;
    }

    /**
     * The panel is preferred so the composer scales with the transcript. When
     * the common frame also owns the sidebar (so it must not be scaled), the
     * transcript alone is the safe fallback.
     */
    function resolvePanel() {
      const anchor = document.querySelector(`[${ANCHOR}]`);
      if (!anchor) return null;
      const transcript = findTranscript(anchor);
      if (!transcript) return null;
      return findPanel(anchor, transcript) || transcript;
    }

    /** Apply the factor to the conversation panel; 100% removes the property. */
    function paint(value) {
      if (!panel || !panel.isConnected) {
        panel = resolvePanel();
        if (!panel) return;
      }
      if (value === DEFAULT) panel.style.removeProperty('zoom');
      else panel.style.zoom = String(value);
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
          if (panel) panel.style.removeProperty('zoom');
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

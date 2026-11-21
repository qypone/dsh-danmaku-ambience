/**
 * Danmaku client module.
 *
 * Streams short lines across the whole frame from `shell.overlay` (root-scoped
 * list slot above every column, outside their scroll containers) and adds a row
 * to `settings.general.item`.
 *
 * Surface notes:
 * - The overlay layer forces `pointer-events: auto` on its direct children, so
 *   the root here sets `none` and only the capsule/panel opt back in. Lines
 *   never intercept clicks.
 * - Horizontal lines animate with a per-node CSS transform; the main thread
 *   runs one scheduling timer. Zen lines are vertical droplets with their own
 *   fall animation.
 * - Colors: controls and containers use host theme tokens. Each line carries a
 *   static hue per mode (the decoration exception) rendered as `hsl()`.
 *   Lines have no background: a near-black outline plus a soft halo gives the
 *   glyph a constant local backdrop, so the copy stays readable over the white
 *   transcript, the gray sidebar, code blocks, and either theme.
 * - Copy is fixed pools; presentation is randomized. Each mode remembers the
 *   recently used sentences so a cycle does not repeat until the pool is spent.
 */
window.__ModuleLoader__.load({
  id: '@local/danmaku',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useRef, useCallback, useSyncExternalStore } = React;
    const h = React.createElement;

    const NS = 'danmaku';
    const STORAGE_KEY = '@local/danmaku/v1';

    // ------------------------------------------------------------------
    // Mode table
    // `interval` is the base gap between lines (ms), jittered per emission.
    // `hues` are HSL hue angles; `sat`/`light` shape the mood.
    //
    // Lines carry no background pill: a near-black outline is what keeps them
    // readable over arbitrary page content. That makes legibility independent
    // of what is behind the text, so every mode uses a light, saturated ink
    // against the same dark stroke (worst case 5.08:1 across all hues).
    // ------------------------------------------------------------------
    const MODES = {
      workaholic: {
        interval: 5000,
        lanes: 8,
        speed: 250,
        fontSize: 15,
        weight: 700,
        spacing: '0.01em',
        vertical: false,
        hues: [352, 8, 22, 340],
        sat: 82,
        light: 58,
      },
      zen: {
        interval: 30000,
        lanes: 5,
        speed: 0,
        fontSize: 13,
        weight: 400,
        spacing: '0.2em',
        vertical: true,
        hues: [186, 196, 176],
        sat: 34,
        light: 66,
      },
      encourager: {
        interval: 11000,
        lanes: 6,
        speed: 155,
        fontSize: 15,
        weight: 500,
        spacing: '0.02em',
        vertical: false,
        hues: [36, 46, 22, 100],
        sat: 88,
        light: 60,
      },
      companion: {
        interval: 17000,
        lanes: 6,
        speed: 120,
        fontSize: 15,
        weight: 500,
        spacing: '0.03em',
        vertical: false,
        hues: [268, 248, 288, 216],
        sat: 72,
        light: 70,
      },
    };
    const ORDER = ['workaholic', 'zen', 'encourager', 'companion'];
    // `scale` is a user multiplier on each mode's base font size.
    const DEFAULT_STATE = { mode: 'encourager', density: 1, opacity: 0.85, scale: 1 };
    const DENSITY = { min: 0.4, max: 2.2, step: 0.1 };
    const OPACITY = { min: 0.2, max: 1, step: 0.05 };
    // Font scale: 0.7x .. 1.8x of the mode baseline, in 0.1 steps.
    const SCALE = { min: 0.7, max: 1.8, step: 0.1 };

    // ------------------------------------------------------------------
    // Phrase pools (English seeds; the Chinese comes from the locale
    // dictionary). Keys are `phrase.<mode>.<index>`.
    // ------------------------------------------------------------------
    const POOLS = {
      workaholic: [
        'The progress bar will not move itself.',
        'Not the time for a phone break.',
        'Five minutes now is ten tomorrow.',
        'You have a few too many tabs open.',
        'Stop switching windows. I am counting.',
        'This one takes twenty minutes. Start.',
        'That "almost done" was half an hour ago.',
        'Make it run before you make it pretty.',
        'You drifted. Come back.',
        'What will you leave behind today?',
        'One line left. Just one.',
        'You have been sitting here a while.',
        'Do not rewrite it. Get it green.',
        'What you dodge now returns tonight.',
        'Focus is not a gift. It is this next choice.',
        'Close three tabs. You know which ones.',
        'Nobody is going to review a file that does not exist.',
        'Write the test. Then you may celebrate.',
        'The hard part is the next ten minutes.',
        'Shipping beats polishing.',
        'Your future self is watching this commit.',
        'Read it once more. Then commit.',
        'Small step now, or a long night later.',
        'The cursor has not moved in four minutes.',
        'No new ideas. Finish this one.',
        'You said "five minutes" twice already.',
        'This is the part where people quit. You do not.',
        'One task. The rest can wait.',
        'Type the first line. The rest follows.',
        'Do the ugly version now, the beautiful one later.',
        'You are one commit away from a clean slate.',
        'Stop reading. Start writing.',
        'The bug is a liar. Test it.',
        'Time is a resource with no refunds.',
        'Respect the deadline you set yourself.',
        'Ten minutes of real focus beats an hour of half.',
        'You already know what to do.',
        'The next step is smaller than it feels.',
        'One more paragraph, then a break.',
        'Do not leave it half-wired.',
        'Finish the loop before starting a new one.',
        'Your keyboard is waiting.',
      ],
      zen: [
        'One thing.', 'Breathe.',
        'Slow is smooth.', 'Just this step.',
        'Less, but deeper.', 'Let it run first.',
        'It need not be perfect.', 'Whitespace is work too.',
        'Listen. The keyboard stopped.', 'The answer comes when you stop gripping.',
        'Begin again.', 'Small and complete.',
        'Let the next line be enough.', 'Quiet is part of the work.',
      ],
      encourager: [
        'That paragraph you wrote is clear.',
        'This part was hard. You got through it.',
        'Stopping is not quitting. It is charging.',
        'Good progress today, truly.',
        'Do not fear the refactor. You know it better now.',
        'You are clearer than when you started.',
        'That bug will crack eventually.',
        'Nice rhythm. Keep it.',
        'The hard half is behind you.',
        'Take your time. You are on the right path.',
        'Look at you, solving another one.',
        'You look good writing code.',
        'Give yourself some credit.',
        'Easy now. Errors are information too.',
        'You are more reliable than you think.',
        'Smoother than last time.',
        'Visible progress.',
        'Not giving up is rare. Well done.',
        'Breaking it small. You are already doing it.',
        'Good work today.',
        'You handled that gracefully.',
        'That was a clean decision.',
        'You are learning faster than you notice.',
        'The design is coming together.',
        'You asked the right question.',
        'Still here, still going. That counts.',
        'You fixed it without breaking anything else.',
        'The code you left behind is tidier.',
        'That was a real improvement, not a cosmetic one.',
        'You kept your cool through the errors.',
        'Your tests are doing their job. So are you.',
        'One more, and you are done for today.',
        'It is fine to be proud of this.',
        'You shipped something today.',
        'The next step will be easier.',
        'You are the kind of person who finishes.',
        'Progress you cannot see is still progress.',
        'You made it more understandable.',
        'That refactor was the right call.',
        'Whatever happens, you showed up.',
        'You are doing better than the version of you from last month.',
      ],
      companion: [
        'I am right here.',
        'Drink some water when you finish.',
        'Let us think about this together.',
        'What time is it outside?',
        'Want to put on some music?',
        'Stretch a little.',
        'I am here while you are quiet.',
        'No rush. I am beside you.',
        'The wind seems nice today.',
        'Leave it if it will not click.',
        'I know that stuck feeling.',
        'Rest if you are tired. I will wait.',
        'Write slowly. There is no deadline.',
        'Another day moved forward together.',
        'Look out the window when you look up.',
        'Do not carry it alone.',
        'I remember what you said.',
        'Tea first, then the bug.',
        'How is your back feeling?',
        'The lamp is still on. So am I.',
        'You do not have to talk. Just work.',
        'I will stay until you finish this bit.',
        'Some days are just slow days. That is allowed.',
        'Remember to blink.',
        'You have been focused a long time. Nice.',
        'Sit up a little straighter.',
        'I am not going anywhere.',
        'The room is quiet. It is a good quiet.',
        'Whatever you are worried about, it can wait a minute.',
        'Your hands must be tired by now.',
        'Easy hours. They are the good ones.',
        'I like this part of the day.',
        'You are not behind. You are here.',
        'Unclench your jaw.',
        'One more thing, then rest.',
        'I am listening if you want to say something aloud.',
        'Put the phone down for a while. I am here.',
        'We can stop whenever you want.',
        'It is okay to enjoy this.',
        'Just you and the cursor. I am keeping watch.',
        'You look a little tired. Maybe that is just focus.',
      ],
    };

    // ------------------------------------------------------------------
    // Dictionaries. The Chinese copy is the primary composition language;
    // English mirrors it key for key.
    // ------------------------------------------------------------------
    const UI_EN = {
      'mode.workaholic': 'Workaholic',
      'mode.zen': 'Zen',
      'mode.encourager': 'Encourager',
      'mode.companion': 'Companion',
      'mode.off': 'Off',
      'panel.title': 'Danmaku mood',
      'panel.pace': 'Pace',
      'panel.opacity': 'Opacity',
      'panel.size': 'Font size',
            'paces.slow': 'Slow',
      'paces.normal': 'Normal',
      'paces.fast': 'Fast',
      'capsule.label': 'Danmaku: {mode}',
      'range.opacity': 'Opacity {value}%',
      'settings.title': 'Danmaku',
      'settings.description': 'Ambient lines drift across the window. Turn them on here; pick a mood from the capsule at the bottom right.',
      'settings.aria': 'Enable ambient danmaku',
    };
    const UI_ZH = {
      'mode.workaholic': '工作狂',
      'mode.zen': '禅',
      'mode.encourager': '鼓励师',
      'mode.companion': '陪伴',
      'mode.off': '关闭',
      'panel.title': '弹幕氛围',
      'panel.pace': '节奏',
      'panel.opacity': '不透明度',
      'panel.size': '字号',
      'paces.slow': '慢',
      'paces.normal': '标准',
      'paces.fast': '快',
      'capsule.label': '弹幕：{mode}',
      'range.opacity': '不透明度 {value}%',
      'settings.title': '弹幕',
      'settings.description': '短句会飘过窗口。在这里开关，氛围在右下角的胶囊里选择。',
      'settings.aria': '开启弹幕氛围',
    };
    const PHRASES_ZH = {
      workaholic: [
        '进度条不会自己走。', '现在不是看手机的时候。', '再拖五分钟，明天就是十分钟。',
        '你打开的标签页有点多了。', '别切窗口了，我数着呢。', '这件事只要二十分钟，开始吧。',
        '上一个“马上就好”已经是半小时前了。', '先让它跑起来，再让它好看。', '分心了，回来。',
        '今天想留下点什么？', '还差最后一行。就一行。', '在这个位置已经坐挺久了。',
        '别想着重写，先跑通。', '现在逃掉的，今晚会变成焦虑。', '专注不是天赋，是现在这个决定。',
        '关掉三个标签页，你知道是哪三个。', '不存在的文件，没人能给你评审。', '先写测试，再庆祝。',
        '最难的就是接下来的十分钟。', '能发版比能打磨更重要。', '未来的你正在看这次提交。',
        '再读一遍，然后提交。', '现在小走一步，或者晚点熬一场。', '光标已经四分钟没动了。',
        '别再开新想法了，先把这一个做完。', '“五分钟”这句话你已经说两遍了。', '这里是大部分人放弃的地方。你没有。',
        '一件事。其余的都可以等。', '打出第一行，剩下的会跟上。', '现在先做丑的版本，漂亮的以后再说。',
        '你离一次干净的提交只差一步。', '别读了，开始写。', '这个 bug 会骗人，测一下它。',
        '时间这种资源没有退款。', '尊重你自己定的截止时间。', '十分钟真专注，胜过一小时半吊子。',
        '你已经知道该做什么了。', '下一步没有你想的那么大。', '再写一小段，就休息。',
        '别把它做成半成品。', '这个循环收尾了，再开下一个。', '键盘在等你。',
      ],
      zen: [
        '一件事', '呼吸', '慢即是快',
        '此刻只做这一步', '少一点深一点', '先让它跑起来',
        '不必完美', '留白也是工作', '听输入法停了',
        '答案在你松手的时候来', '重新开始', '小而完整',
        '下一行就够了', '安静也是工作的一部分',
      ],
      encourager: [
        '你刚才那段写得挺清楚。', '这一步不好啃，你啃下来了。', '停下来不是放弃，是充电。',
        '今天推进得不错，真的。', '别怕重构，你比昨天更懂它了。', '你已经比开始时清楚多了。',
        '这个 bug 迟早会松口的。', '你的节奏很好，继续保持。', '难的部分已经过去一半。',
        '慢慢来，你在正确的路上。', '了不起，你又解决了一个。', '写代码的你，挺帅的。',
        '记得给自己一点掌声。', '别急，错误也是信息。', '你比你自己以为的更靠谱。',
        '这次比上次顺多了。', '看得见的进步。', '你没有放弃，这很难得。',
        '把大的拆成小的，你已经在做了。', '今天也辛苦啦。', '这件事你处理得很体面。',
        '刚才那个决定很干净。', '你学得比自己以为的快。', '设计正在成形。',
        '你问对了问题。', '还在这儿，还在推进，这就算数。', '你修好了它，而且没弄坏别的。',
        '你留下的代码更整洁了。', '这是真实的改进，不是为了好看。', '报错时你一直没慌。',
        '你的测试在干活，你也是。', '再来一个，今天就收工。', '为这件事骄傲一下也没关系。',
        '你今天交付了东西。', '下一步会更容易。', '你是那种会做完的人。',
        '看不见的进步也是进步。', '你让它更容易理解了。', '那次重构是对的。',
        '不管怎样，你都到场了。', '你比上个月的自己强多了。',
      ],
      companion: [
        '我在这儿呢。', '忙完记得喝口水。', '这段代码我陪你想。',
        '窗外几点啦？', '要不要放首歌？', '伸个懒腰吧。',
        '你安静的时候，我在。', '不着急，我在旁边。', '今天的风好像不错。',
        '想不通就先放着。', '我懂这种卡住的感觉。', '累了就歇会儿，我等着。',
        '慢慢写，不赶时间。', '又是一起推进的一天。', '你抬头的时候，记得看看窗外。',
        '别一个人硬扛。', '你说的我都记着。', '先喝口茶，再抓 bug。',
        '你的背还好吗？', '灯还亮着，我也在。', '你不用说话，干活就行。',
        '这段做完我再走。', '有些日子就是慢日子，这没关系。', '记得眨眼。',
        '你专注了很久，挺好的。', '坐直一点。', '我哪儿也不去。',
        '房间里很安静，是好的那种安静。', '你担心的事，可以再等一分钟。', '手应该累了吧。',
        '松快的时间，都是好时间。', '我喜欢一天的这个时候。', '你没有落后，你就在这儿。',
        '牙关松开一点。', '再做一件，就休息。', '想说出声的时候，我听着。',
        '别刷手机了，陪你一会儿。', '想停随时都可以。', '享受这件事，是允许的。',
        '你和光标，我守着。', '你看起来有点累，也许只是专注。',
      ],
        };

    const EN = { ...UI_EN };
    const ZH = { ...UI_ZH };
    for (const mode of ORDER) {
      POOLS[mode].forEach((text, i) => { EN['phrase.' + mode + '.' + i] = text; });
      PHRASES_ZH[mode].forEach((text, i) => { ZH['phrase.' + mode + '.' + i] = text; });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    function clampNumber(value, min, max, fallback) {
      // `Number('')` is 0 and `Number(null)` is 0, so reject those first: an
      // absent value must fall back, not clamp to the minimum.
      if (value === '' || value === null || value === undefined) return fallback;
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    }

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_STATE };
        const parsed = JSON.parse(raw);
        const mode = parsed && (parsed.mode === null || ORDER.includes(parsed.mode))
          ? parsed.mode
          : DEFAULT_STATE.mode;
        return {
          mode,
          density: clampNumber(parsed && parsed.density, DENSITY.min, DENSITY.max, DEFAULT_STATE.density),
          opacity: clampNumber(parsed && parsed.opacity, OPACITY.min, OPACITY.max, DEFAULT_STATE.opacity),
          scale: clampNumber(parsed && parsed.scale, SCALE.min, SCALE.max, DEFAULT_STATE.scale),
        };
      } catch {
        return { ...DEFAULT_STATE };
      }
    }

    function saveState(state) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
    }

    function createStore() {
      let snapshot = loadState();
      const listeners = new Set();
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        update(patch) {
          const next = { ...snapshot, ...patch };
          if (next.mode === snapshot.mode
            && next.density === snapshot.density
            && next.opacity === snapshot.opacity
            && next.scale === snapshot.scale) return;
          snapshot = next;
          saveState(next);
          for (const listener of [...listeners]) listener();
        },
      };
    }

    function hslToRgb(hueValue, sat, light) {
      const s = sat / 100;
      const l = light / 100;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const hp = (((hueValue % 360) + 360) % 360) / 60;
      const x = c * (1 - Math.abs((hp % 2) - 1));
      let rgb;
      if (hp < 1) rgb = [c, x, 0];
      else if (hp < 2) rgb = [x, c, 0];
      else if (hp < 3) rgb = [0, c, x];
      else if (hp < 4) rgb = [0, x, c];
      else if (hp < 5) rgb = [x, 0, c];
      else rgb = [c, 0, x];
      const m = l - c / 2;
      return rgb.map((v) => Math.round((v + m) * 255));
    }

    function modeColor(mode) {
      const cfg = MODES[mode];
      if (!cfg) return 'var(--dsw-alias-label-secondary)';
      const [r, g, b] = hslToRgb(cfg.hues[0], cfg.sat, cfg.light);
      return `rgb(${r}, ${g}, ${b})`;
    }

    /**
     * Build the visual tone of one line. Lines draw a light, saturated ink over
     * a near-black outline, which is what danmaku overlays have always used to
     * stay readable over unknown content: the outline supplies a constant local
     * backdrop, so contrast no longer depends on the page behind the text.
     *
     * The ink is deliberately light in BOTH themes because the stroke is the
     * constant; the mode hue survives, and the worst ink-to-stroke contrast
     * across every hue and mode is above 5:1.
     * @param hue - HSL hue angle for this line.
     * @param sat - saturation percentage.
     * @param light - lightness percentage.
     * @returns CSS declarations for color, stroke, and glow.
     */
    function toneFor(hue, sat, light) {
      const ink = `hsl(${hue} ${sat}% ${light}%)`;
      return {
        ink,
        // `-webkit-text-stroke` paints the outline behind the glyph thanks to
        // `paint-order: stroke fill`; the blur is a halo that survives on
        // busy backgrounds such as code blocks.
        stroke: 'rgba(8,8,12,.92)',
        glow: '0 0 3px rgba(0,0,0,.85), 0 0 8px rgba(0,0,0,.45)',
      };
    }

    function prefersReducedMotion() {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /** Visible lifetime of a line under reduced motion (must match the CSS). */
    const STATIC_MS = 4200;

    /**
     * Bucket a density value into a spoken pace label.
     * @param density - 0.4..2.2.
     * @returns pace dictionary key.
     */
    function paceKey(density) {
      if (density < 0.85) return 'slow';
      if (density > 1.4) return 'fast';
      return 'normal';
    }

    /**
     * Resolve the pixel font size for one line: the mode baseline times the
     * user's scale preference, kept inside a sane range so an extreme setting
     * cannot produce unreadable or billboard-sized text.
     * @param cfg - the mode entry.
     * @param scale - user multiplier.
     * @returns font size in px.
     */
    function fontSizeFor(cfg, scale) {
      const value = cfg.fontSize * (Number.isFinite(scale) ? scale : 1);
      return Math.round(Math.min(40, Math.max(10, value)) * 10) / 10;
    }

    // ------------------------------------------------------------------
    // Phrase rotation: avoid repeating a line until the pool has been spent.
    // A finished cycle may otherwise restart on the same line that just
    // appeared, so the previous draw is remembered and re-rolled once.
    // ------------------------------------------------------------------
    function createPicker() {
      const state = new Map(); // mode -> { remaining: number[], last: number }
      return function pick(mode) {
        const pool = POOLS[mode];
        if (!pool || pool.length === 0) return -1;
        let entry = state.get(mode);
        if (!entry || entry.remaining.length === 0) {
          entry = { remaining: pool.map((_, i) => i), last: entry ? entry.last : -1 };
          state.set(mode, entry);
        }
        let at = Math.floor(Math.random() * entry.remaining.length);
        // Re-roll once when the cycle restart handed back the previous line.
        if (entry.remaining[at] === entry.last && entry.remaining.length > 1) {
          at = (at + 1 + Math.floor(Math.random() * (entry.remaining.length - 1))) % entry.remaining.length;
        }
        const index = entry.remaining.splice(at, 1)[0];
        entry.last = index;
        return index;
      };
    }

    // ------------------------------------------------------------------
    // Launcher: owns the DOM nodes and the single scheduling timer.
    // ------------------------------------------------------------------
    function createLauncher(container, store, translate, pick) {
      let timer = null;
      let running = false;
      const live = new Set();
      const laneBusy = new Map(); // mode -> number[] of "free at" timestamps

      function lanesFor(mode) {
        const cfg = MODES[mode];
        let busy = laneBusy.get(mode);
        if (!busy || busy.length !== cfg.lanes) {
          busy = new Array(cfg.lanes).fill(0);
          laneBusy.set(mode, busy);
        }
        return busy;
      }

      function pickLane(busy) {
        const now = Date.now();
        let best = 0;
        let bestAt = Infinity;
        for (let i = 0; i < busy.length; i += 1) {
          if (busy[i] <= now) return i;
          if (busy[i] < bestAt) { bestAt = busy[i]; best = i; }
        }
        return best;
      }

      function phraseFor(mode) {
        const index = pick(mode);
        const text = translate('phrase.' + mode + '.' + index);
        // A missing dictionary returns the key; fall back to the seed pool.
        return text === 'phrase.' + mode + '.' + index ? POOLS[mode][index] : text;
      }

      /**
       * Estimate rendered width. A CJK glyph is about one em wide while Latin
       * averages nearer half, so a flat per-character estimate undershoots
       * Chinese copy badly and lets its tail leave frame early.
       * @param text - the line.
       * @param fontSize - pixel size.
       * @param spacingEm - letter spacing in em.
       * @returns approximate width in px, excluding padding.
       */
      function estimateWidth(text, fontSize, spacingEm) {
        let em = 0;
        for (const ch of text) em += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55;
        return em * fontSize + text.length * spacingEm * fontSize;
      }

      function track(node, lifetimeMs) {
        const item = { node, timer: null };
        live.add(item);
        item.timer = setTimeout(() => {
          node.remove();
          live.delete(item);
        }, lifetimeMs);
        return item;
      }

      /** Horizontal positions of the columns currently on screen. */
      function occupiedColumns() {
        const taken = [];
        for (const item of live) {
          const value = parseFloat(item.node.style.left);
          if (Number.isFinite(value)) taken.push(value);
        }
        return taken;
      }

      function spawnHorizontal(mode, snapshot) {
        const cfg = MODES[mode];
        const busy = lanesFor(mode);
        const lane = pickLane(busy);
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;

        const text = phraseFor(mode);
        const hueValue = cfg.hues[Math.floor(Math.random() * cfg.hues.length)];
        const tone = toneFor(hueValue, cfg.sat, cfg.light);
        const fontSize = fontSizeFor(cfg, snapshot.scale);

        const node = document.createElement('div');
        node.className = 'dmb-line';
        node.textContent = text;
        node.dataset.mode = mode;
        node.setAttribute('aria-hidden', 'true');
        node.style.setProperty('--dmb-ink', tone.ink);
        node.style.setProperty('--dmb-stroke', tone.stroke);
        node.style.setProperty('--dmb-glow', tone.glow);
        node.style.setProperty('--dmb-size', fontSize + 'px');
        node.style.setProperty('--dmb-weight', String(cfg.weight));
        node.style.setProperty('--dmb-spacing', cfg.spacing);

        // Lanes live in the upper-middle band; the bottom stays clear of the
        // capsule and the composer.
        const bandTop = Math.round(height * 0.12);
        const bandHeight = Math.round(height * 0.56);
        const laneHeight = bandHeight / cfg.lanes;
        node.style.top = Math.round(bandTop + laneHeight * lane + laneHeight * 0.15) + 'px';

        // With reduced motion, lines fade in place instead of travelling.
        if (prefersReducedMotion()) {
          node.classList.add('dmb-static');
          container.appendChild(node);
          busy[lane] = Date.now() + STATIC_MS;
          track(node, STATIC_MS);
          return;
        }

        // Lines have no padding any more, but the outline extends past the
        // glyph box, so allow for the stroke and the halo on both sides.
        const outline = fontSize * 0.35 + 8;
        const estimated = Math.min(
          estimateWidth(text, fontSize, parseFloat(cfg.spacing)) + outline * 2,
          width * 0.85,
        );
        const distance = width + estimated + 32;
        const speed = cfg.speed * (0.85 + 0.3 * Math.random()) * (0.72 + 0.4 * snapshot.density);
        const seconds = Math.max(3.2, Math.min(28, distance / speed));
        node.style.setProperty('--dmb-from', (width + 8) + 'px');
        node.style.setProperty('--dmb-to', (-estimated - 16) + 'px');
        node.style.animationDuration = seconds.toFixed(2) + 's';

        container.appendChild(node);

        // Keep the lane reserved until this line's tail has entered the frame.
        const enterRatio = Math.min(1, (estimated + 32) / distance);
        busy[lane] = Date.now() + seconds * 1000 * enterRatio + 260;
        track(node, seconds * 1000 + 160);
      }

      // ------------------------------------------------------------------
      // Zen column: one character per box, stacked top to bottom.
      //
      // `writing-mode: vertical-rl` is not used on purpose. It relies on
      // vertical glyph forms that are tuned for Japanese; Chinese 。 and ，
      // have no upright variants, so they land visibly off-centre. Stacking
      // each character in its own box centres every glyph, punctuation
      // included, which is how Chinese vertical typesetting reads.
      //
      // The Chinese zen pool carries no punctuation, so it drops cleanly into
      // a column. Punctuated copy (English, or a locale that keeps stops)
      // would read wrong once stacked — "Listen. The keyboard stopped." turns
      // into "Listen The keyboard stopped" — so those labels render as a
      // horizontal run instead of a column.
      // ------------------------------------------------------------------
      function isVerticalFriendly(text) {
        // Any sentence punctuation or whitespace means the text reads as a
        // phrase, not a bare word list, so it is set horizontally.
        return !/[.,!?;:，。！？、；："'（）\s]/.test(text);
      }

      function buildColumn(text, fontSize, color) {
        const column = document.createElement('div');
        column.className = 'dmb-col';
        for (const ch of text) {
          const cell = document.createElement('span');
          cell.className = 'dmb-col-cell';
          cell.textContent = ch;
          cell.style.fontSize = fontSize + 'px';
          column.appendChild(cell);
        }
        column.style.setProperty('--dmb-ink', color.ink);
        column.style.setProperty('--dmb-stroke', color.stroke);
        column.style.setProperty('--dmb-glow', color.glow);
        return column;
      }

      function spawnDroplet(mode, snapshot) {
        const cfg = MODES[mode];
        const busy = lanesFor(mode);
        const lane = pickLane(busy);
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        const text = phraseFor(mode);
        const hueValue = cfg.hues[Math.floor(Math.random() * cfg.hues.length)];
        const tone = toneFor(hueValue, cfg.sat, cfg.light);
        const fontSize = fontSizeFor(cfg, snapshot.scale);

        const node = document.createElement('div');
        node.className = 'dmb-drop';
        node.dataset.mode = mode;
        node.setAttribute('aria-hidden', 'true');
        node.style.setProperty('--dmb-weight', String(cfg.weight));
        node.style.setProperty('--dmb-size', fontSize + 'px');

        // Punctuated copy keeps its sentence shape; it is set horizontally.
        const stacked = isVerticalFriendly(text);
        node.dataset.layout = stacked ? 'column' : 'row';
        if (stacked) {
          node.appendChild(buildColumn(text, fontSize, tone));
        } else {
          const run = document.createElement('div');
          run.className = 'dmb-run';
          run.textContent = text;
          run.style.setProperty('--dmb-ink', tone.ink);
          run.style.setProperty('--dmb-stroke', tone.stroke);
          run.style.setProperty('--dmb-glow', tone.glow);
          node.appendChild(run);
        }

        // Spread columns across the whole frame. Lane-to-x mapping alone fails
        // here: with a 30s interval every column is gone before the next one
        // is emitted, so the lane picker always returns lane 0 and every
        // column lands at the same left offset. Pick x directly at random and
        // only use the lane to avoid reusing a spot still occupied.
        const columnWidth = stacked ? fontSize * 1.3 : Math.min(width * 0.5, text.length * fontSize * 0.62);
        const minX = Math.max(16, width * 0.04);
        const maxX = Math.max(minX, width - columnWidth - Math.max(16, width * 0.06));
        const taken = occupiedColumns();
        let x = null;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const candidate = minX + Math.random() * (maxX - minX);
          if (!taken.some((t) => Math.abs(t - candidate) < columnWidth * 2.2)) { x = candidate; break; }
        }
        // Every nearby spot is busy; fall back to the widest gap available.
        if (x === null) {
          const sorted = [...taken].sort((a, b) => a - b);
          let bestGap = -Infinity;
          let bestAt = minX;
          let prev = minX - columnWidth * 2.2;
          for (const t of sorted.concat([maxX])) {
            const gap = t - prev;
            if (gap > bestGap) { bestGap = gap; bestAt = prev + gap / 2; }
            prev = t;
          }
          x = Math.min(maxX, Math.max(minX, bestAt));
        }
        node.style.left = Math.round(x) + 'px';
        node.style.setProperty('--dmb-drift', (Math.random() * 26 - 13).toFixed(1) + 'px');

        // Slow fall: this is the zen pace, not a fast drop.
        const fall = (9 + Math.random() * 4) / (0.85 + 0.3 * snapshot.density);

        if (prefersReducedMotion()) {
          // Static mode replaces the fall with a fade in place. Give each
          // column its own vertical slot so successive ones cannot stack.
          node.classList.add('dmb-static');
          const bandTop = Math.round(height * 0.15);
          const slotHeight = Math.round((height * 0.55) / cfg.lanes);
          node.style.top = Math.round(bandTop + slotHeight * lane) + 'px';
          container.appendChild(node);
          // The lane must stay busy for the full visible lifetime, not a
          // fixed guess, or a 30s interval will reuse it while still shown.
          busy[lane] = Date.now() + STATIC_MS;
          track(node, STATIC_MS);
          return;
        }

        node.style.setProperty('--dmb-fall-to', Math.round(height * 0.78) + 'px');
        node.style.animationDuration = fall.toFixed(2) + 's';

        container.appendChild(node);
        busy[lane] = Date.now() + 2200;
        track(node, fall * 1000 + 240);
      }

      function saturated(mode) {
        const cfg = MODES[mode];
        return live.size >= (cfg.vertical ? 4 : cfg.lanes + 3);
      }

      function arm(delay) {
        clearTimeout(timer);
        const snapshot = store.getSnapshot();
        const cfg = snapshot.mode ? MODES[snapshot.mode] : null;
        if (!running || !cfg) return;
        timer = setTimeout(emit, Math.max(600, delay));
      }

      function emit() {
        if (!running) return;
        const snapshot = store.getSnapshot();
        const mode = snapshot.mode;
        const cfg = mode ? MODES[mode] : null;
        if (!cfg) { running = false; return; }

        if (!saturated(mode) && document.visibilityState !== 'hidden') {
          try {
            if (cfg.vertical) spawnDroplet(mode, snapshot);
            else spawnHorizontal(mode, snapshot);
          } catch (error) {
            console.error('[danmaku] spawn failed', error);
          }
        }

        // Density shortens the gap; jitter keeps the rhythm organic.
        const base = (cfg.interval / snapshot.density) * (0.7 + Math.random() * 0.65);
        arm(base);
      }

      function clear() {
        for (const item of live) {
          clearTimeout(item.timer);
          item.node.remove();
        }
        live.clear();
        laneBusy.clear();
      }

      function start(immediate) {
        running = true;
        clear();
        arm(immediate ? 300 : (MODES[store.getSnapshot().mode] || { interval: 8000 }).interval * 0.5);
      }

      function stop() {
        running = false;
        clearTimeout(timer);
        timer = null;
        clear();
      }

      /** Re-evaluate after a preferences change. */
      function sync(previousMode) {
        const mode = store.getSnapshot().mode;
        if (!mode) { stop(); return; }
        // A mode switch restarts cleanly so the change reads immediately.
        if (previousMode !== undefined && previousMode !== mode) { start(true); return; }
        if (!running) { start(true); return; }
        clearTimeout(timer);
        const base = (MODES[mode].interval / store.getSnapshot().density) * (0.7 + Math.random() * 0.65);
        arm(base);
      }

      return { sync, stop };
    }

    // ------------------------------------------------------------------
    // Styles
    // ------------------------------------------------------------------
    const CSS = `
      .dmb-root{position:absolute;inset:0;pointer-events:none;overflow:hidden}
      .dmb-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;opacity:var(--dmb-opacity,.85)}

      /* Lines carry no background. A four-sided offset of a near-black colour
         paints an outline; the outer blur is a halo. Together they give the
         glyph a constant local backdrop, so the text stays readable over white
         transcript, gray sidebar, code blocks, or a dark theme. */
      .dmb-line{position:absolute;left:0;white-space:nowrap;
        color:var(--dmb-ink);
        font-family:inherit;font-size:var(--dmb-size,15px);font-weight:var(--dmb-weight,500);
        letter-spacing:var(--dmb-spacing,0);line-height:1.45;
        -webkit-text-stroke:2.5px var(--dmb-stroke,rgba(8,8,12,.92));
        paint-order:stroke fill;
        text-shadow:var(--dmb-glow,0 0 3px rgba(0,0,0,.85));will-change:transform;
        animation-name:dmb-scroll;animation-timing-function:linear;animation-fill-mode:forwards}
      @keyframes dmb-scroll{
        0%{transform:translate3d(var(--dmb-from,100vw),0,0);opacity:0}
        5%{opacity:1}
        95%{opacity:1}
        100%{transform:translate3d(var(--dmb-to,-100%),0,0);opacity:0}
      }

      /* Zen column: characters stacked top to bottom. The outer node carries
         the fall animation; the inner column gives each glyph its own centred
         box so Chinese punctuation sits directly below the preceding character
         (a vertical writing-mode would misplace it). */
      .dmb-drop{position:absolute;top:-24px;opacity:0;
        font-family:inherit;font-weight:var(--dmb-weight,400);
        animation-name:dmb-fall;animation-timing-function:cubic-bezier(.42,0,.58,1);
        animation-fill-mode:forwards}
      .dmb-col{display:flex;flex-direction:column;align-items:center;gap:0}
      /* Punctuated zen copy (English) keeps its sentence shape as one line. */
      .dmb-run{white-space:nowrap;color:var(--dmb-ink);
        font-size:var(--dmb-size,13px);line-height:1.4;
        -webkit-text-stroke:calc(var(--dmb-size,13px) * .1) var(--dmb-stroke,rgba(8,8,12,.82));
        paint-order:stroke fill;
        text-shadow:var(--dmb-glow,none)}
      /* The stroke tracks the font size so a scaled-up column keeps the same
         outline weight relation as the default; a fixed px value would look
         thin at 1.8x and heavy at 0.7x. */
      .dmb-col-cell{display:block;width:1.3em;text-align:center;line-height:1.25;
        font-size:var(--dmb-size,13px);
        color:var(--dmb-ink);
        -webkit-text-stroke:calc(var(--dmb-size,13px) * .12) var(--dmb-stroke,rgba(8,8,12,.82));
        paint-order:stroke fill;
        text-shadow:var(--dmb-glow,none)}
      @keyframes dmb-fall{
        0%{transform:translate3d(0,0,0);opacity:0}
        20%{opacity:.92}
        80%{opacity:.55}
        100%{transform:translate3d(var(--dmb-drift,0),var(--dmb-fall-to,78vh),0);opacity:0}
      }

      /* Reduced motion: fade in place. The launcher gives each line its own
         vertical slot so successive lines cannot overlap. */
      .dmb-line.dmb-static,.dmb-drop.dmb-static{animation:dmb-static 4.2s ease forwards}
      @keyframes dmb-static{0%{opacity:0}12%{opacity:.95}80%{opacity:.95}100%{opacity:0}}

      .dmb-capsule{position:absolute;right:16px;bottom:64px;pointer-events:auto;
        display:flex;align-items:center;gap:6px;height:30px;padding:0 10px;box-sizing:border-box;
        border:1px solid var(--dsw-alias-border-l2);border-radius:999px;
        background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));
        color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;
        box-shadow:0 2px 8px rgba(0,0,0,.12);opacity:.55;
        transition:opacity .15s,background .15s,border-color .15s}
      .dmb-capsule:hover,.dmb-capsule:focus-visible,.dmb-capsule[aria-expanded="true"]{opacity:1;background:var(--dsw-alias-bg-module-platform)}
      .dmb-capsule:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
      .dmb-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dmb-dot,var(--dsw-alias-label-secondary))}
      .dmb-glyph{display:grid;place-items:center;width:14px;height:14px;flex:none}

      .dmb-panel{position:absolute;right:16px;bottom:102px;pointer-events:auto;width:264px;
        padding:12px;box-sizing:border-box;border-radius:12px;
        border:1px solid var(--dsw-alias-border-l2);
        background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));
        color:var(--dsw-alias-label-primary);font:inherit;
        box-shadow:0 8px 28px rgba(0,0,0,.22)}
      .dmb-panel-title{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
      .dmb-modes{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .dmb-mode{appearance:none;display:flex;align-items:center;gap:6px;padding:7px 8px;box-sizing:border-box;
        border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;
        color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer;
        transition:background .15s,border-color .15s}
      .dmb-mode:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dmb-mode:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
      .dmb-mode[aria-pressed="true"]{border-color:var(--dsw-alias-border-selected);background:var(--dsw-alias-bg-module-platform)}
      .dmb-check{width:12px;height:12px;flex:none;margin-left:auto;visibility:hidden}
      .dmb-mode[aria-pressed="true"] .dmb-check{visibility:visible}
      .dmb-row{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:10px;
        border-top:1px solid var(--dsw-alias-border-l2)}
      .dmb-row-label{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dmb-row-value{flex:none;min-width:34px;font-size:11px;text-align:right;font-variant-numeric:tabular-nums;
        color:var(--dsw-alias-label-secondary)}
      .dmb-range{flex:1;min-width:0;height:20px;accent-color:var(--dsw-alias-state-business-primary)}
      .dmb-range:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
      .dmb-mode-off{margin-top:6px}

      .dmb-rows{display:flex;align-items:center;justify-content:space-between;gap:24px;
        padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
      .dmb-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
      .dmb-desc{margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .dmb-controls{display:flex;align-items:center;gap:8px;flex:none}
      .dmb-switch{position:relative;width:36px;height:20px;flex:none;padding:0;
        border-radius:var(--dsw-radius-lg,999px);cursor:pointer;
        border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);
        transition:background .15s,border-color .15s}
      .dmb-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary);border-color:transparent}
      .dmb-switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
      .dmb-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
        background:var(--dsw-alias-switch-thumb,var(--dsw-alias-bg-base));
        box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s}
      .dmb-switch[aria-checked="true"] .dmb-knob{transform:translateX(16px)}
    `;

    // ------------------------------------------------------------------
    // Icons
    // ------------------------------------------------------------------
    function IconDanmaku() {
      return h('svg', { className: 'dmb-glyph', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M1 4.5h6.5M4.5 8h8M1.5 11.5h5.5',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        }));
    }
    function IconCheck() {
      return h('svg', { className: 'dmb-check', viewBox: '0 0 12 12', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2 6.2 4.6 9 10 3.4', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        }));
    }

    // ------------------------------------------------------------------
    // Overlay: layer + capsule + panel
    // ------------------------------------------------------------------
    function DanmakuOverlay({ store, pick, t }) {
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      const [open, setOpen] = useState(false);
      const layerRef = useRef(null);
      const panelRef = useRef(null);
      const capsuleRef = useRef(null);
      const mode = snapshot.mode;

      // The launcher outlives renders; it reads preferences through the store.
      useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return undefined;
        const launcher = createLauncher(layer, store, t, pick);
        let previous = store.getSnapshot().mode;
        launcher.sync(undefined);
        const unsubscribe = store.subscribe(() => {
          const next = store.getSnapshot().mode;
          launcher.sync(previous);
          previous = next;
        });
        // A hidden tab stops emitting; resume without a burst of catch-up lines.
        const onVisibility = () => launcher.sync(previous);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          document.removeEventListener('visibilitychange', onVisibility);
          unsubscribe();
          launcher.stop();
        };
      }, [store, t, pick]);

      // Close on Escape or an outside press. Escape is handled only while the
      // panel is open and is not swallowed from the rest of the app when the
      // event did not originate inside the panel.
      useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          const target = event.target;
          const inside = panelRef.current && panelRef.current.contains(target);
          if (!inside) return;
          event.preventDefault();
          setOpen(false);
          if (capsuleRef.current) capsuleRef.current.focus();
        };
        const onPointerDown = (event) => {
          const target = event.target;
          if (panelRef.current && panelRef.current.contains(target)) return;
          if (capsuleRef.current && capsuleRef.current.contains(target)) return;
          setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [open]);

      const selectMode = useCallback((next) => {
        store.update({ mode: next });
        setOpen(false);
        if (capsuleRef.current) capsuleRef.current.focus();
      }, [store]);

      const activeLabel = mode ? t('mode.' + mode) : t('mode.off');

      return h('div', { className: 'dmb-root', style: { '--dmb-opacity': snapshot.opacity } }, [
        h('style', { key: 'css' }, CSS),
        h('div', { key: 'layer', ref: layerRef, className: 'dmb-layer', 'aria-hidden': 'true' }),

        h('button', {
          key: 'capsule',
          ref: capsuleRef,
          type: 'button',
          className: 'dmb-capsule',
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          'aria-label': t('capsule.label', { mode: activeLabel }),
          title: t('capsule.label', { mode: activeLabel }),
          onClick: () => setOpen((value) => !value),
        }, [
          h('span', {
            key: 'dot',
            className: 'dmb-dot',
            style: { '--dmb-dot': mode ? modeColor(mode) : 'var(--dsw-alias-label-tertiary)' },
          }),
          h(IconDanmaku, { key: 'glyph' }),
          h('span', { key: 'label' }, activeLabel),
        ]),

        open ? h('div', {
          key: 'panel',
          ref: panelRef,
          className: 'dmb-panel',
          role: 'dialog',
          'aria-label': t('panel.title'),
        }, [
          h('div', { key: 'title', className: 'dmb-panel-title', id: 'dmb-panel-title' }, t('panel.title')),
          h('div', { key: 'modes', className: 'dmb-modes', role: 'group', 'aria-label': t('panel.title') },
            ORDER.concat(['off']).map((key) => {
              const isOff = key === 'off';
              const active = isOff ? mode === null : mode === key;
              return h('button', {
                key,
                type: 'button',
                className: 'dmb-mode' + (isOff ? ' dmb-mode-off' : ''),
                'aria-pressed': active,
                onClick: () => selectMode(isOff ? null : key),
              }, [
                h('span', {
                  key: 'dot',
                  className: 'dmb-dot',
                  style: { '--dmb-dot': isOff ? 'var(--dsw-alias-label-tertiary)' : modeColor(key) },
                }),
                h('span', { key: 'label' }, isOff ? t('mode.off') : t('mode.' + key)),
                h(IconCheck, { key: 'check' }),
              ]);
            })),

          h('div', { key: 'pace', className: 'dmb-row' }, [
            h('label', { key: 'label', className: 'dmb-row-label', htmlFor: 'dmb-pace' }, t('panel.pace')),
            h('input', {
              key: 'input',
              id: 'dmb-pace',
              className: 'dmb-range',
              type: 'range',
              min: DENSITY.min,
              max: DENSITY.max,
              step: DENSITY.step,
              value: snapshot.density,
              'aria-valuetext': t('paces.' + paceKey(snapshot.density)),
              onChange: (event) => store.update({ density: clampNumber(event.target.value, DENSITY.min, DENSITY.max, 1) }),
            }),
            h('span', { key: 'value', className: 'dmb-row-value' }, t('paces.' + paceKey(snapshot.density))),
          ]),

          h('div', { key: 'opacity', className: 'dmb-row' }, [
            h('label', { key: 'label', className: 'dmb-row-label', htmlFor: 'dmb-opacity' }, t('panel.opacity')),
            h('input', {
              key: 'input',
              id: 'dmb-opacity',
              className: 'dmb-range',
              type: 'range',
              min: OPACITY.min,
              max: OPACITY.max,
              step: OPACITY.step,
              value: snapshot.opacity,
              'aria-valuetext': Math.round(snapshot.opacity * 100) + '%',
              onChange: (event) => store.update({ opacity: clampNumber(event.target.value, OPACITY.min, OPACITY.max, 1) }),
            }),
            h('span', { key: 'value', className: 'dmb-row-value' }, Math.round(snapshot.opacity * 100) + '%'),
          ]),

          h('div', { key: 'size', className: 'dmb-row' }, [
            h('label', { key: 'label', className: 'dmb-row-label', htmlFor: 'dmb-size' }, t('panel.size')),
            h('input', {
              key: 'input',
              id: 'dmb-size',
              className: 'dmb-range',
              type: 'range',
              min: SCALE.min,
              max: SCALE.max,
              step: SCALE.step,
              value: snapshot.scale,
              'aria-valuetext': Math.round(snapshot.scale * 100) + '%',
              onChange: (event) => store.update({ scale: clampNumber(event.target.value, SCALE.min, SCALE.max, 1) }),
            }),
            h('span', { key: 'value', className: 'dmb-row-value' }, Math.round(snapshot.scale * 100) + '%'),
          ]),
        ]) : null,
      ]);
    }

    // ------------------------------------------------------------------
    // Settings row (settings.general.item)
    // ------------------------------------------------------------------
    function DanmakuSettingsRow({ store, t }) {
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      const enabled = Boolean(snapshot.mode);
      // Remember the last active mood so re-enabling returns to it instead of
      // silently resetting to the default.
      const lastModeRef = useRef(snapshot.mode || DEFAULT_STATE.mode);
      if (snapshot.mode) lastModeRef.current = snapshot.mode;

      return h('div', { className: 'dmb-rows', role: 'group', 'aria-label': t('settings.title') }, [
        h('style', { key: 'css' }, CSS),
        h('div', { key: 'text' }, [
          h('div', { key: 'title', className: 'dmb-title' }, t('settings.title')),
          h('div', { key: 'desc', className: 'dmb-desc' }, t('settings.description')),
        ]),
        h('div', { key: 'controls', className: 'dmb-controls' },
          h('button', {
            type: 'button',
            className: 'dmb-switch',
            role: 'switch',
            'aria-checked': enabled,
            'aria-label': t('settings.aria'),
            onClick: () => store.update({ mode: enabled ? null : (lastModeRef.current || DEFAULT_STATE.mode) }),
          }, h('span', { key: 'knob', className: 'dmb-knob' }))),
      ]);
    }

    // ------------------------------------------------------------------
    // Module entry
    // ------------------------------------------------------------------
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const store = createStore();
        const pick = createPicker();

        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'danmaku: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'danmaku',
          locale: NS,
          inject: () => ({ store, pick, t }),
        }, DanmakuOverlay));

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'danmaku',
          order: 60,
          locale: NS,
          inject: () => ({ store, t }),
        }, DanmakuSettingsRow));
      },
    };
  },
});

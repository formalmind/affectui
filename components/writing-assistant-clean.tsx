"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";

/*
 * Writing Assistant – clean style. A compact AI chat card, in a single self-contained file.
 * One white card: a header with the assistant's name, a welcome line with suggestion chips, and the prompt row
 * as the last row with a mic and a send button. The pink-violet-blue of the classic style stays as a small accent:
 * the sparkle next to the name and a faint glow behind the welcome line.
 * Pick a suggestion, type, or dictate: the words appear live in the field, and once you stop speaking the
 * finished text moves into the chat as your message. Replies stream in word by word.
 * Dictation uses the browser's speech recognition where available and a short simulated take otherwise.
 * The styles are injected below, so no extra files are needed.
 */

export type WritingAssistantProps = {
  name?: string;
  tagline?: string;
  /** Line on the welcome screen */
  greeting?: string;
  suggestions?: string[];
  placeholder?: string;
  /** Your answer for a message – return text or a promise of text. A sample writer is used by default */
  respond?: (message: string) => string | Promise<string>;
  /** "auto" uses real speech recognition when the browser has it; "simulate" always plays a sample take */
  speech?: "auto" | "simulate";
  /** Sample sentence for simulated dictation */
  dictation?: string;
  className?: string;
};

type Message = { id: number; role: "user" | "assistant"; text: string };

/** A word with the whitespace after it */
const tokens = (text: string) => text.match(/\s*\S+\s*/g) ?? [];

const sampleReply = (message: string) => {
  const m = message.toLowerCase();
  if (m.includes("remind"))
    return "Hi team, just a friendly nudge: the report is due this Friday. If anything is holding you up, let me know today and we'll sort it out together. Thanks!";
  if (m.includes("shorter") || m.includes("short"))
    return "Here's a tighter version: “Thanks for the quick turnaround – the new draft reads much better. Let's ship it Friday.”";
  if (m.includes("tone"))
    return "I softened the opening and swapped the direct ask for a question, so it sounds friendly but still clear about the deadline.";
  if (m.includes("reply"))
    return "Hi Sam, thanks for the update! Thursday works for me – I'll bring the revised numbers so we can decide on the spot.";
  if (m.includes("email") || m.includes("polish"))
    return "I fixed two typos, split the long second paragraph and moved your main ask to the first line, so it's the first thing they read.";
  return "Got it. Here's a first draft – tell me if it should sound more formal, shorter or more playful, and I'll adjust it.";
};

// Minimal typing for the Web Speech API, which isn't in the DOM lib yet
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

// One line of the prompt is 20px; the field grows up to four lines, then scrolls
const LINE = 20;
const FIELD_PAD = 8;

export function WritingAssistant({
  name = "Quill",
  tagline = "Your writing companion.",
  greeting = "What should we write?",
  suggestions = ["Polish my email", "Make it shorter", "Fix the tone", "Draft a reply"],
  placeholder = "Ask anything…",
  respond = sampleReply,
  speech = "auto",
  dictation = "Write a friendly reminder that the report is due on Friday",
  className,
}: WritingAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streamed, setStreamed] = useState<{ id: number; words: number } | null>(null);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const timers = useRef<number[]>([]);
  const gradientId = "ui-wac" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      recRef.current?.abort();
    },
    [],
  );

  // The field grows with its text up to four lines, then scrolls – and keeps the newest words in view
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 4 * LINE + FIELD_PAD)}px`;
    if (listening || document.activeElement !== el) el.scrollTop = el.scrollHeight;
  }, [draft, interim, listening]);

  // Keep the newest message in view
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streamed]);

  // When the prompt grows and the chat gets shorter, the messages move up with it instead of being cut off
  const chatting = messages.length > 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let lastHeight = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight < lastHeight) el.scrollTop = el.scrollHeight;
      lastHeight = el.clientHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [chatting]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setDraft("");
    setInterim("");
    const userMsg: Message = { id: nextId.current++, role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    let reply: string;
    try {
      const [answer] = await Promise.all([Promise.resolve(respond(text)), new Promise((r) => later(() => r(null), 700))]);
      reply = typeof answer === "string" ? answer : String(answer ?? "");
    } catch {
      // A failing writer must not leave the card stuck on "Writing…"
      reply = "Couldn't write a reply – try again.";
    }
    // An empty answer leaves no empty bubble behind
    if (!reply.trim()) return setBusy(false);
    const id = nextId.current++;
    setMessages((m) => [...m, { id, role: "assistant", text: reply }]);
    // Stream the reply in word by word – one timer for the whole reply, however long
    const words = tokens(reply).length;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || words < 2) {
      setStreamed(null);
      setBusy(false);
      return;
    }
    let shown = 0;
    const tick = window.setInterval(() => {
      shown++;
      if (shown <= words) return setStreamed({ id, words: shown });
      window.clearInterval(tick);
      setStreamed(null);
      setBusy(false);
    }, 38);
    timers.current.push(tick);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  /* ---------- Dictation ---------- */

  const finishDictation = (text: string) => {
    setListening(false);
    setInterim("");
    if (text.trim()) {
      setDraft(text.trim());
      // A short beat so you see the finished sentence, then it moves into the chat
      later(() => send(text), 450);
    }
  };

  const simulate = () => {
    setListening(true);
    setDraft("");
    const words = dictation.split(/\s+/);
    words.forEach((_, i) => later(() => setInterim(words.slice(0, i + 1).join(" ")), 260 + i * 170));
    later(() => finishDictation(dictation), 260 + words.length * 170 + 500);
  };

  const startListening = () => {
    if (busy) return;
    const Ctor =
      speech === "auto"
        ? ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
            .SpeechRecognition ??
          (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition)
        : undefined;
    if (!Ctor) return simulate();
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    finalRef.current = "";
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim(`${finalRef.current}${live}`);
    };
    rec.onerror = (e) => {
      // No mic access or no speech service – fall back to the sample take
      recRef.current = null;
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "network") simulate();
      else setListening(false);
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      finishDictation(finalRef.current);
    };
    recRef.current = rec;
    setDraft("");
    setInterim("");
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      simulate();
    }
  };

  const stopListening = () => {
    if (recRef.current) recRef.current.stop();
  };

  const reset = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    recRef.current?.abort();
    recRef.current = null;
    setMessages([]);
    setDraft("");
    setInterim("");
    setListening(false);
    setBusy(false);
    setStreamed(null);
  };

  // Words keep the space or line break after them, so line breaks show while a reply streams in too
  const shownText = (m: Message) => (streamed?.id === m.id ? tokens(m.text).slice(0, streamed.words).join("") : m.text);

  return (
    <div className={["ui-wac", className].filter(Boolean).join(" ")} data-chat={chatting ? "" : undefined}>
      <style href="ui-writing-assistant-clean" precedence="default">
        {css}
      </style>

      <header className="ui-wac__head">
        <div className="ui-wac__id">
          <h3 className="ui-wac__name">
            {/* The classic gradient, kept as a small accent */}
            <svg className="ui-wac__mark" viewBox="0 0 16 16" aria-hidden="true">
              <defs>
                <linearGradient id={gradientId} x1="2" y1="2" x2="14" y2="14" gradientUnits="userSpaceOnUse">
                  <stop stopColor="var(--ui-wac-pink)" />
                  <stop offset="0.5" stopColor="var(--ui-wac-violet)" />
                  <stop offset="1" stopColor="var(--ui-wac-blue)" />
                </linearGradient>
              </defs>
              <path
                fill={`url(#${gradientId})`}
                d="M8 1.5c.3 2.9 1.6 4.2 4.5 4.5-2.9.3-4.2 1.6-4.5 4.5-.3-2.9-1.6-4.2-4.5-4.5 2.9-.3 4.2-1.6 4.5-4.5Z"
              />
              <path
                fill={`url(#${gradientId})`}
                d="M12.25 10c.13 1.3.7 1.87 2 2-1.3.13-1.87.7-2 2-.13-1.3-.7-1.87-2-2 1.3-.13 1.87-.7 2-2Z"
              />
            </svg>
            <span className="ui-wac__name-text" title={name}>
              {name}
            </span>
          </h3>
          <p className="ui-wac__tagline" title={tagline}>
            {tagline}
          </p>
        </div>
        <button type="button" className="ui-wac__new" aria-label="New chat" onClick={reset} tabIndex={chatting ? 0 : -1}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </header>

      <div className="ui-wac__body">
        {/* A faint glow in the library's gradient colors – behind the messages and the prompt alike */}
        <div className="ui-wac__glow" aria-hidden="true">
          <span className="ui-wac__blob ui-wac__blob--pink" />
          <span className="ui-wac__blob ui-wac__blob--violet" />
          <span className="ui-wac__blob ui-wac__blob--blue" />
        </div>
        <div className="ui-wac__content">
          {chatting ? (
            <div className="ui-wac__messages" ref={listRef} aria-live="polite">
              {messages.map((m) => (
                <p key={m.id} className={`ui-wac__msg ui-wac__msg--${m.role}`} dir="auto">
                  {shownText(m)}
                </p>
              ))}
              {busy && !streamed && messages[messages.length - 1]?.role === "user" && (
                <p className="ui-wac__msg ui-wac__msg--assistant ui-wac__typing" aria-label="Writing">
                  <span className="ui-wac__shimmer" data-text="Writing…" aria-hidden="true">
                    Writing…
                  </span>
                </p>
              )}
            </div>
          ) : (
            <div className="ui-wac__welcome">
              <p className="ui-wac__greeting" dir="auto">{greeting}</p>
              {suggestions.length > 0 && (
                <div className="ui-wac__chips">
                  {suggestions.map((s, i) => (
                    <button key={`${i}-${s}`} type="button" className="ui-wac__chip" title={s} dir="auto" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* The last row: the prompt, the mic and send */}
        <form className="ui-wac__row" onSubmit={onSubmit}>
          <div className="ui-wac__field" data-listening={listening ? "" : undefined}>
            <textarea
              ref={inputRef}
              rows={1}
              value={listening ? interim : draft}
              readOnly={listening}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift + Enter starts a new line
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              placeholder={listening ? "Listening…" : placeholder}
              aria-label="Message"
              dir="auto"
            />
          </div>
          <button
            type="button"
            className="ui-wac__mic"
            data-listening={listening ? "" : undefined}
            aria-pressed={listening}
            aria-label={listening ? "Stop dictation" : "Dictate"}
            onClick={listening ? stopListening : startListening}
            disabled={busy && !listening}
          >
            <span className="ui-wac__pulse" aria-hidden="true" />
            {listening ? (
              <span className="ui-wac__wave" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3ZM6 11.5a6 6 0 0 0 12 0M12 17.5v3" />
              </svg>
            )}
          </button>
          {draft && !listening && (
            <button type="submit" className="ui-wac__send" aria-label="Send" disabled={busy}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5.5M6 11c0 0 4.4-6 6-6s6 6 6 6" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-wac */
.ui-wac {
  --ui-wac-card: #ffffff;
  --ui-wac-strong: #000000;
  --ui-wac-ink: rgba(0, 0, 0, 0.88);
  --ui-wac-text: rgba(0, 0, 0, 0.61);
  --ui-wac-muted: rgba(0, 0, 0, 0.45);
  --ui-wac-faint: rgba(0, 0, 0, 0.27);
  --ui-wac-icon: rgba(0, 0, 0, 0.447);
  --ui-wac-line: rgba(0, 0, 0, 0.06);
  --ui-wac-fill: rgba(0, 0, 0, 0.06);
  --ui-wac-wash: rgba(0, 0, 0, 0.03);
  --ui-wac-solid: rgba(0, 0, 0, 0.88);
  --ui-wac-on-solid: #fcfcfc;
  --ui-wac-accent: rgba(0, 96, 226, 0.765);
  --ui-wac-accent-wash: rgba(0, 96, 226, 0.08);
  --ui-wac-accent-ring: rgba(0, 96, 226, 0.22);
  --ui-wac-shine: rgba(255, 255, 255, 0.82);
  /* The classic gradient: Pro pink, violet and accent blue – only a small accent here */
  --ui-wac-pink: #ec4899;
  --ui-wac-violet: #8b5cf6;
  --ui-wac-blue: #2f6bff;
  --ui-wac-glow: 0.13;
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-wac-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-wac-focus: rgba(0, 96, 226, 0.35);
  --ui-wac-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 380px;
  overflow: hidden;
  border-radius: 10px;
  background: var(--ui-wac-card);
  box-shadow: var(--ui-wac-shadow);
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-wac-ink);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
.ui-wac *, .ui-wac *::before, .ui-wac *::after { box-sizing: border-box; }
:where(.ui-wac) button {
  appearance: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
:where(.ui-wac) svg { display: block; flex: none; }
.ui-wac button:focus-visible { outline: 2px solid var(--ui-wac-focus); outline-offset: 1px; }

/* ---------- Header ---------- */
.ui-wac__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 12px 12px 16px;
  border-bottom: 0.5px solid var(--ui-wac-line);
}
.ui-wac__id { min-width: 0; }
.ui-wac__name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: var(--ui-wac-strong);
}
.ui-wac__mark { width: 16px; height: 16px; }
.ui-wac__name-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-wac__tagline {
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ui-wac-text);
}
/* New chat: a ghost icon button that shows up once there's a conversation */
.ui-wac__new {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--ui-wac-icon);
  opacity: 0;
  transform: scale(0.8);
  pointer-events: none;
  transition: opacity 220ms ease, transform 320ms var(--ui-wac-ease), background-color 160ms ease, color 160ms ease;
}
.ui-wac[data-chat] .ui-wac__new { opacity: 1; transform: none; pointer-events: auto; }
.ui-wac__new:hover { background: var(--ui-wac-wash); color: var(--ui-wac-ink); }
.ui-wac__new svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; }

/* ---------- Body: content above, the prompt as the last row ---------- */
.ui-wac__body { position: relative; display: flex; flex-direction: column; height: 340px; overflow: hidden; }
.ui-wac__content {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
}

/* A faint glow in the lower part – it keeps drifting, and quiets down once you chat */
.ui-wac__glow { position: absolute; inset: 0; pointer-events: none; opacity: 1; transition: opacity 600ms ease; }
.ui-wac[data-chat] .ui-wac__glow { opacity: 0.4; }
.ui-wac__blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(36px);
  opacity: var(--ui-wac-glow);
  animation: ui-wac-drift-a 6s ease-in-out infinite alternate;
}
.ui-wac__blob--pink { left: -18%; top: 54%; width: 58%; height: 40%; background: var(--ui-wac-pink); }
.ui-wac__blob--violet { right: -16%; top: 46%; width: 54%; height: 42%; background: var(--ui-wac-violet); animation-name: ui-wac-drift-b; animation-duration: 7s; }
.ui-wac__blob--blue { left: 22%; bottom: -22%; width: 62%; height: 40%; background: var(--ui-wac-blue); animation-name: ui-wac-drift-c; animation-duration: 5.5s; }

/* Welcome */
.ui-wac__welcome { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 16px; animation: ui-wac-in 380ms var(--ui-wac-ease) both; }
.ui-wac__greeting { margin: 0; overflow-wrap: anywhere; font-size: 15px; font-weight: 500; line-height: 24px; color: var(--ui-wac-strong); }
.ui-wac__chips { display: flex; flex-wrap: wrap; gap: 6px; }
/* Suggestion chips: the button-switch look – a hairline, gray text */
.ui-wac__chip {
  padding: 4px 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ui-wac-card) 70%, transparent);
  box-shadow: inset 0 0 0 0.5px var(--ui-wac-line);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  /* A long suggestion shortens instead of leaving the card – the full text is its tooltip */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ui-wac-text);
  transition: background-color 160ms ease, color 160ms ease, transform 160ms var(--ui-wac-ease);
}
.ui-wac__chip:hover { background: linear-gradient(var(--ui-wac-wash), var(--ui-wac-wash)), color-mix(in srgb, var(--ui-wac-card) 70%, transparent); color: var(--ui-wac-ink); }
.ui-wac__chip:active { transform: scale(0.97); }

/* Chat */
.ui-wac__messages {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding: 16px 16px 14px;
  overflow-y: auto;
  scrollbar-width: none;
  /* Soft edges at the top and towards the prompt, so nothing ends in a hard cut */
  -webkit-mask-image: linear-gradient(transparent, #000 16px, #000 calc(100% - 12px), transparent);
  mask-image: linear-gradient(transparent, #000 16px, #000 calc(100% - 12px), transparent);
}
.ui-wac__messages::-webkit-scrollbar { display: none; }
.ui-wac__msg {
  max-width: 86%;
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ui-wac-ink);
  animation: ui-wac-in 320ms var(--ui-wac-ease) both;
}
.ui-wac__msg--user { align-self: flex-end; padding: 6px 10px; border-radius: 10px; background: var(--ui-wac-fill); }
.ui-wac__msg--assistant { align-self: flex-start; max-width: 94%; }
.ui-wac__typing { color: var(--ui-wac-muted); }

/* "Writing…": a dark band sweeps across a copy of the label */
.ui-wac__shimmer { position: relative; display: inline-block; }
.ui-wac__shimmer::after {
  content: attr(data-text);
  content: attr(data-text) / "";
  position: absolute;
  inset: 0;
  white-space: nowrap;
  color: transparent;
  background: linear-gradient(90deg, transparent 38%, var(--ui-wac-shine) 50%, transparent 62%) 100% 0 / 300% 100% no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ui-wac-sweep 1.3s linear infinite;
  pointer-events: none;
}

/* ---------- Prompt row: lies right in the card – no own fill, no line above ---------- */
.ui-wac__row {
  position: relative;
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  margin: 0;
  padding: 6px 10px 10px 16px;
}
/* Text wraps; the field grows up to four lines and the buttons stay at the bottom */
.ui-wac__field { flex: 1; min-width: 0; display: flex; margin-right: 4px; }
.ui-wac__field textarea {
  display: block;
  flex: 1;
  min-width: 0;
  height: 28px;
  margin: 0;
  padding: 4px 0;
  border: 0;
  background: none;
  outline: none;
  resize: none;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-wac-strong);
  caret-color: var(--ui-wac-accent);
  overflow-y: auto;
  scrollbar-width: none;
  /* Lines scrolled up fade out at the top edge instead of being cut */
  -webkit-mask-image: linear-gradient(transparent, #000 4px);
  mask-image: linear-gradient(transparent, #000 4px);
}
.ui-wac__field textarea::-webkit-scrollbar { display: none; }
.ui-wac__field textarea::placeholder { color: var(--ui-wac-faint); opacity: 1; }
.ui-wac__field[data-listening] textarea { color: var(--ui-wac-text); }

/* Send: the dark chip */
.ui-wac__send {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--ui-wac-solid) !important;
  color: var(--ui-wac-on-solid);
  transition: transform 160ms var(--ui-wac-ease), opacity 160ms ease;
  animation: ui-wac-pop 280ms var(--ui-wac-ease) both;
}
.ui-wac__send:disabled { opacity: 0.4; cursor: default; }
.ui-wac__send:not(:disabled):active { transform: scale(0.94); }
.ui-wac__send svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

/* Mic: a ghost icon button */
.ui-wac__mic {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--ui-wac-icon);
  transition: background-color 200ms ease, color 160ms ease, transform 160ms var(--ui-wac-ease);
}
.ui-wac__mic:not(:disabled):hover { background: var(--ui-wac-wash); color: var(--ui-wac-ink); }
.ui-wac__mic:not(:disabled):active { transform: scale(0.94); }
.ui-wac__mic:disabled { opacity: 0.5; cursor: default; }
.ui-wac__mic svg { position: relative; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

/* Listening: a light accent tile, three calm bars inside and a soft ring breathing outwards */
.ui-wac__mic[data-listening],
.ui-wac__mic[data-listening]:hover { background: var(--ui-wac-accent-wash); color: var(--ui-wac-accent); }
.ui-wac__pulse { position: absolute; inset: 0; border-radius: 6px; opacity: 0; }
.ui-wac__mic[data-listening] .ui-wac__pulse { opacity: 1; animation: ui-wac-ring 1.6s ease-out infinite; }
.ui-wac__wave { position: relative; display: flex; align-items: center; gap: 2px; height: 12px; }
.ui-wac__wave i {
  width: 2px;
  height: 100%;
  border-radius: 1px;
  background: currentColor;
  transform: scaleY(0.35);
  animation: ui-wac-wave 1.1s ease-in-out infinite;
}
.ui-wac__wave i:nth-child(2) { animation-delay: -0.35s; }
.ui-wac__wave i:nth-child(3) { animation-delay: -0.7s; }

@keyframes ui-wac-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-wac-pop { from { opacity: 0; transform: scale(0.6); } }
@keyframes ui-wac-sweep { from { background-position: 100% 0; } to { background-position: 0% 0; } }
@keyframes ui-wac-ring { 0% { box-shadow: 0 0 0 0 var(--ui-wac-accent-ring); } 100% { box-shadow: 0 0 0 7px transparent; } }
@keyframes ui-wac-wave { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
@keyframes ui-wac-drift-a {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(55%, -22%) scale(1.25); }
  100% { transform: translate(20%, 14%) scale(0.85); }
}
@keyframes ui-wac-drift-b {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-55%, 24%) scale(0.85); }
  100% { transform: translate(-22%, -16%) scale(1.25); }
}
@keyframes ui-wac-drift-c {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-45%, -26%) scale(1.2); }
  100% { transform: translate(30%, -10%) scale(0.88); }
}

/* Narrow containers: a little less padding */
@container (max-width: 330px) {
  .ui-wac__head { padding-left: 12px; }
  .ui-wac__welcome, .ui-wac__messages { padding-left: 12px; padding-right: 12px; }
  .ui-wac__row { padding-left: 12px; }
}
/* Touch screens: taller hit targets */
@media (pointer: coarse) {
  .ui-wac__new, .ui-wac__mic, .ui-wac__send { width: 34px; height: 34px; }
  .ui-wac__chip { padding: 7px 12px; }
  .ui-wac__field textarea { padding: 7px 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-wac__blob, .ui-wac__welcome, .ui-wac__msg, .ui-wac__send, .ui-wac__mic[data-listening] .ui-wac__pulse, .ui-wac__wave i, .ui-wac__shimmer::after { animation: none; }
  .ui-wac__wave i { transform: scaleY(0.7); }
}

/* Text fields: no focus box while typing – also against global :focus-visible rules of the host page */
.ui-wac input:not([type="checkbox"]):not([type="radio"]):focus-visible,
.ui-wac textarea:focus-visible,
.ui-wac [contenteditable]:focus-visible { outline: none; }

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-wac {
  --ui-wac-card: #1c1c1e;
  --ui-wac-strong: #ffffff;
  --ui-wac-ink: rgba(255, 255, 255, 0.9);
  --ui-wac-text: rgba(255, 255, 255, 0.62);
  --ui-wac-muted: rgba(255, 255, 255, 0.46);
  --ui-wac-faint: rgba(255, 255, 255, 0.3);
  --ui-wac-icon: rgba(255, 255, 255, 0.5);
  --ui-wac-line: rgba(255, 255, 255, 0.08);
  --ui-wac-fill: rgba(255, 255, 255, 0.08);
  --ui-wac-wash: rgba(255, 255, 255, 0.04);
  --ui-wac-solid: rgba(255, 255, 255, 0.92);
  --ui-wac-on-solid: #161618;
  --ui-wac-accent: #4d8dff;
  --ui-wac-accent-wash: rgba(77, 141, 255, 0.14);
  --ui-wac-accent-ring: rgba(77, 141, 255, 0.3);
  --ui-wac-shine: #ffffff;
  --ui-wac-pink: #f472b6;
  --ui-wac-violet: #a78bfa;
  --ui-wac-blue: #4d82ff;
  --ui-wac-glow: 0.14;
  --ui-wac-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-wac-focus: rgba(77, 141, 255, 0.5);
}
`;

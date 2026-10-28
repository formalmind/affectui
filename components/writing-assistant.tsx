"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

/*
 * Writing Assistant – a compact AI chat card, in a single self-contained file.
 * A soft pink-violet-blue glow behind a welcome line, suggestion chips, a prompt field and a mic button.
 * Pick a suggestion, type, or dictate: the words appear live in the field, and once you stop speaking the
 * finished text moves into the chat as your message. Replies stream in word by word.
 * Dictation uses the browser's speech recognition where available and a short simulated take otherwise.
 * The styles are injected below, so no extra files are needed.
 */

export type WritingAssistantProps = {
  name?: string;
  tagline?: string;
  /** Big line on the welcome screen */
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
    el.style.height = `${Math.min(el.scrollHeight, 4 * 21 + 19)}px`;
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
    <div className={["ui-wa", className].filter(Boolean).join(" ")} data-chat={chatting ? "" : undefined}>
      <style href="ui-writing-assistant" precedence="default">
        {css}
      </style>

      <header className="ui-wa__head">
        <div className="ui-wa__id">
          <h3 className="ui-wa__name" title={name}>
            {name}
          </h3>
          <p className="ui-wa__tagline" title={tagline}>
            {tagline}
          </p>
        </div>
        <button type="button" className="ui-wa__new" aria-label="New chat" onClick={reset} tabIndex={chatting ? 0 : -1}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5.5v13M5.5 12h13" />
          </svg>
        </button>
      </header>

      <div className="ui-wa__panel">
        {/* Soft glow in the library's gradient colors */}
        <div className="ui-wa__glow" aria-hidden="true">
          <span className="ui-wa__blob ui-wa__blob--pink" />
          <span className="ui-wa__blob ui-wa__blob--violet" />
          <span className="ui-wa__blob ui-wa__blob--blue" />
        </div>

        <div className="ui-wa__body">
          {chatting ? (
            <div className="ui-wa__messages" ref={listRef} aria-live="polite">
              {messages.map((m) => (
                <p key={m.id} className={`ui-wa__msg ui-wa__msg--${m.role}`} dir="auto">
                  {shownText(m)}
                </p>
              ))}
              {busy && !streamed && messages[messages.length - 1]?.role === "user" && (
                <p className="ui-wa__msg ui-wa__msg--assistant ui-wa__typing" aria-label="Writing">
                  <i />
                  <i />
                  <i />
                </p>
              )}
            </div>
          ) : (
            <div className="ui-wa__welcome">
              <p className="ui-wa__greeting" dir="auto">{greeting}</p>
              {suggestions.length > 0 && (
                <div className="ui-wa__chips">
                  {suggestions.map((s, i) => (
                    <button key={`${i}-${s}`} type="button" className="ui-wa__chip" title={s} dir="auto" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <form className="ui-wa__row" onSubmit={onSubmit}>
            <div className="ui-wa__field" data-listening={listening ? "" : undefined}>
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
              {draft && !listening && (
                <button type="submit" className="ui-wa__send" aria-label="Send" disabled={busy}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 18.5v-13M6.5 11 12 5.5l5.5 5.5" />
                  </svg>
                </button>
              )}
            </div>
            <button
              type="button"
              className="ui-wa__mic"
              data-listening={listening ? "" : undefined}
              aria-pressed={listening}
              aria-label={listening ? "Stop dictation" : "Dictate"}
              onClick={listening ? stopListening : startListening}
              disabled={busy && !listening}
            >
              <span className="ui-wa__pulse" aria-hidden="true" />
              {listening ? (
                <span className="ui-wa__wave" aria-hidden="true">
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
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-wa {
  --ui-wa-card: #ffffff;
  --ui-wa-panel: #fbfbfb;
  --ui-wa-line: #ececec;
  --ui-wa-ink: #171717;
  --ui-wa-text: #404040;
  --ui-wa-muted: #8f8f8f;
  --ui-wa-chip: rgba(0, 0, 0, 0.055);
  --ui-wa-chip-hover: rgba(0, 0, 0, 0.09);
  --ui-wa-field: #ffffff;
  --ui-wa-focus-line: #d4d4d4;
  --ui-wa-user: rgba(0, 0, 0, 0.06);
  --ui-wa-assistant: rgba(255, 255, 255, 0.85);
  /* The library's gradient: Pro pink, violet and accent blue */
  --ui-wa-pink: #ec4899;
  --ui-wa-violet: #8b5cf6;
  --ui-wa-blue: #2f6bff;
  --ui-wa-glow: 0.28;
  --ui-wa-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 12px 32px rgba(0, 0, 0, 0.06);
  --ui-wa-ease: cubic-bezier(0.22, 1, 0.36, 1);
  width: 100%;
  max-width: 380px;
  padding: 8px;
  border: 1px solid var(--ui-wa-line);
  border-radius: 32px;
  background: var(--ui-wa-card);
  box-shadow: var(--ui-wa-shadow);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ui-wa-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-wa *, .ui-wa *::before, .ui-wa *::after { box-sizing: border-box; }
.ui-wa button { font: inherit; color: inherit; margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-wa :focus-visible:not(textarea) { outline: 2px solid var(--ui-wa-blue); outline-offset: 2px; }

/* ---------- Header ---------- */

.ui-wa__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 18px 16px; }
.ui-wa__new { flex: none; }
.ui-wa__id { min-width: 0; }
.ui-wa__name { margin: 0; overflow: hidden; font-size: 20px; font-weight: 500; letter-spacing: -0.02em; white-space: nowrap; text-overflow: ellipsis; }
.ui-wa__tagline { margin: 3px 0 0; overflow: hidden; font-size: 13px; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-wa-muted); }
.ui-wa__new {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--ui-wa-chip);
  color: var(--ui-wa-text) !important;
  opacity: 0;
  transform: scale(0.8);
  pointer-events: none;
  transition: opacity 220ms ease, transform 320ms var(--ui-wa-ease), background-color 160ms ease;
}
.ui-wa[data-chat] .ui-wa__new { opacity: 1; transform: none; pointer-events: auto; }
.ui-wa__new:hover { background: var(--ui-wa-chip-hover); }
.ui-wa__new svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }

/* ---------- Panel with the glow ---------- */

.ui-wa__panel {
  position: relative;
  overflow: hidden;
  /* Card radius 32 minus its 8px padding, so the corners run parallel */
  border-radius: 24px;
  background: var(--ui-wa-panel);
  box-shadow: inset 0 0 0 1px var(--ui-wa-line);
}
.ui-wa__glow { position: absolute; inset: 0; pointer-events: none; }
/* The glow sits in the lower part and keeps moving – clearly visible, never still */
.ui-wa__blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(34px);
  opacity: var(--ui-wa-glow);
  animation: ui-wa-drift-a 6s ease-in-out infinite alternate;
}
.ui-wa__blob--pink { left: -18%; top: 46%; width: 60%; height: 42%; background: var(--ui-wa-pink); }
.ui-wa__blob--violet { right: -16%; top: 36%; width: 56%; height: 44%; background: var(--ui-wa-violet); animation-name: ui-wa-drift-b; animation-duration: 7s; }
.ui-wa__blob--blue { left: 22%; bottom: -16%; width: 64%; height: 42%; background: var(--ui-wa-blue); animation-name: ui-wa-drift-c; animation-duration: 5.5s; }
.ui-wa[data-chat] .ui-wa__blob { opacity: calc(var(--ui-wa-glow) * 0.6); }

.ui-wa__body {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 18px;
  height: 340px;
  padding: 18px 14px 14px;
}

/* Welcome */
.ui-wa__welcome { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 0 4px; animation: ui-wa-in 380ms var(--ui-wa-ease) both; }
.ui-wa__greeting {
  margin: 0;
  font-size: 24px;
  font-weight: 500;
  line-height: 1.15;
  letter-spacing: -0.025em;
  overflow-wrap: anywhere;
  color: var(--ui-wa-ink);
}
.ui-wa__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ui-wa__chip {
  height: 32px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background: var(--ui-wa-chip);
  font-size: 13px;
  /* A long suggestion shortens instead of leaving the card – the full text is its tooltip */
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ui-wa-text) !important;
  backdrop-filter: blur(8px);
  transition: background-color 160ms ease, transform 160ms ease;
}
.ui-wa__chip:hover { background: var(--ui-wa-chip-hover); }
.ui-wa__chip:active { transform: scale(0.97); }

/* Chat */
.ui-wa__messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  margin: -4px -4px 0;
  padding: 4px;
  overflow-y: auto;
  scrollbar-width: none;
  /* Soft edges at the top and towards the prompt, so nothing ends in a hard cut */
  -webkit-mask-image: linear-gradient(transparent, #000 18px, #000 calc(100% - 16px), transparent);
  mask-image: linear-gradient(transparent, #000 18px, #000 calc(100% - 16px), transparent);
  padding-bottom: 14px;
}
.ui-wa__msg {
  max-width: 86%;
  margin: 0;
  padding: 9px 13px;
  font-size: 13.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  animation: ui-wa-in 320ms var(--ui-wa-ease) both;
}
.ui-wa__msg--user { align-self: flex-end; border-radius: 18px 18px 6px 18px; background: var(--ui-wa-user); }
.ui-wa__msg--assistant {
  align-self: flex-start;
  border-radius: 18px 18px 18px 6px;
  background: var(--ui-wa-assistant);
  box-shadow: 0 0 0 1px var(--ui-wa-line);
  backdrop-filter: blur(10px);
}
.ui-wa__typing { display: inline-flex; gap: 4px; padding: 13px 14px; }
.ui-wa__typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ui-wa-muted);
  animation: ui-wa-dot 1s ease-in-out infinite;
}
.ui-wa__typing i:nth-child(2) { animation-delay: 0.15s; }
.ui-wa__typing i:nth-child(3) { animation-delay: 0.3s; }

/* ---------- Prompt row ---------- */

.ui-wa__row { display: flex; align-items: flex-end; gap: 8px; }
/* Text wraps; the field grows up to four lines and the buttons stay at the bottom */
.ui-wa__field {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-height: 54px;
  padding: 7px 7px 7px 20px;
  border-radius: 27px;
  background: var(--ui-wa-field);
  box-shadow: 0 0 0 1px var(--ui-wa-line), 0 6px 18px rgba(0, 0, 0, 0.06), inset 0 -2px 6px rgba(0, 0, 0, 0.02);
  transition: box-shadow 220ms ease;
}
/* Focused: a slightly stronger gray stroke */
.ui-wa__field:focus-within { box-shadow: 0 0 0 1px var(--ui-wa-focus-line), 0 6px 18px rgba(0, 0, 0, 0.06); }
.ui-wa__field textarea {
  flex: 1;
  min-width: 0;
  height: 40px;
  margin: 0;
  padding: 9.5px 0;
  border: 0;
  background: none;
  outline: none;
  resize: none;
  font: inherit;
  font-size: 14.5px;
  line-height: 21px;
  color: var(--ui-wa-ink);
  overflow-y: auto;
  scrollbar-width: none;
  /* Lines scrolled up fade out at the top edge instead of being cut */
  -webkit-mask-image: linear-gradient(transparent, #000 9px);
  mask-image: linear-gradient(transparent, #000 9px);
}
.ui-wa__field textarea::-webkit-scrollbar { display: none; }
.ui-wa__field textarea::placeholder { color: var(--ui-wa-muted); }
.ui-wa__field[data-listening] textarea { color: var(--ui-wa-text); }
.ui-wa__send {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--ui-wa-ink);
  color: var(--ui-wa-card) !important;
  animation: ui-wa-pop 280ms var(--ui-wa-ease) both;
}
.ui-wa__send:disabled { opacity: 0.5; cursor: default; }
.ui-wa__send svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

.ui-wa__mic {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 54px;
  height: 54px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--ui-wa-field);
  box-shadow: 0 0 0 1px var(--ui-wa-line), 0 6px 18px rgba(0, 0, 0, 0.06);
  transition: transform 200ms var(--ui-wa-ease), background-color 220ms ease;
}
.ui-wa__mic:active { transform: scale(0.95); }
.ui-wa__mic:disabled { opacity: 0.6; cursor: default; }
.ui-wa__mic svg {
  position: relative;
  width: 22px;
  height: 22px;
  fill: none;
  stroke: var(--ui-wa-ink);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Listening: the button turns dark, three calm bars move inside and a soft ring breathes outwards */
.ui-wa__mic[data-listening] { background: var(--ui-wa-ink); box-shadow: 0 0 0 1px var(--ui-wa-ink), 0 6px 18px rgba(0, 0, 0, 0.12); }
.ui-wa__pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-wa-ink) 18%, transparent);
  opacity: 0;
}
.ui-wa__mic[data-listening] .ui-wa__pulse { opacity: 1; animation: ui-wa-ring 1.6s ease-out infinite; }
.ui-wa__wave { position: relative; display: flex; align-items: center; gap: 3px; height: 16px; }
.ui-wa__wave i {
  width: 3px;
  height: 100%;
  border-radius: 2px;
  background: var(--ui-wa-card);
  transform: scaleY(0.35);
  animation: ui-wa-wave 1.1s ease-in-out infinite;
}
.ui-wa__wave i:nth-child(2) { animation-delay: -0.35s; }
.ui-wa__wave i:nth-child(3) { animation-delay: -0.7s; }

@keyframes ui-wa-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-wa-pop { from { opacity: 0; transform: scale(0.6); } }
@keyframes ui-wa-ring { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-wa-ink) 16%, transparent); } 100% { box-shadow: 0 0 0 12px transparent; } }
@keyframes ui-wa-wave { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
@keyframes ui-wa-dot { 0%, 100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }
@keyframes ui-wa-drift-a {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(55%, -22%) scale(1.25); }
  100% { transform: translate(20%, 14%) scale(0.85); }
}
@keyframes ui-wa-drift-b {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-55%, 24%) scale(0.85); }
  100% { transform: translate(-22%, -16%) scale(1.25); }
}
@keyframes ui-wa-drift-c {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-45%, -26%) scale(1.2); }
  100% { transform: translate(30%, -10%) scale(0.88); }
}

@media (prefers-reduced-motion: reduce) {
  .ui-wa__blob, .ui-wa__welcome, .ui-wa__msg, .ui-wa__send, .ui-wa__mic[data-listening] .ui-wa__pulse, .ui-wa__wave i, .ui-wa__typing i { animation: none; }
  .ui-wa__wave i { transform: scaleY(0.7); }
}


/* Text fields: no focus box while typing – also against global :focus-visible rules of the host page */
.ui-wa input:not([type="checkbox"]):not([type="radio"]):focus-visible,
.ui-wa textarea:focus-visible,
.ui-wa [contenteditable]:focus-visible { outline: none; }
/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-wa {
  --ui-wa-card: #232326;
  --ui-wa-panel: #1c1c1f;
  --ui-wa-line: rgba(255, 255, 255, 0.08);
  --ui-wa-ink: #ededed;
  --ui-wa-text: #c4c4c4;
  --ui-wa-muted: #8f8f8f;
  --ui-wa-chip: rgba(255, 255, 255, 0.07);
  --ui-wa-chip-hover: rgba(255, 255, 255, 0.11);
  --ui-wa-field: #2a2a2d;
  --ui-wa-focus-line: rgba(255, 255, 255, 0.2);
  --ui-wa-user: rgba(255, 255, 255, 0.08);
  --ui-wa-assistant: rgba(42, 42, 45, 0.85);
  --ui-wa-pink: #f472b6;
  --ui-wa-violet: #a78bfa;
  --ui-wa-blue: #4d82ff;
  --ui-wa-glow: 0.26;
  --ui-wa-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 32px rgba(0, 0, 0, 0.3);
}
`;

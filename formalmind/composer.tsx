import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowUpIcon, ChevronIcon, ModelMenu, css, type ChatModel } from "../components/chat-composer";

type Picker = { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean };

/** The subset of the app's `ChatComposer` props the swarm chat passes (components/chat-composer.tsx). */
export type ComposerProps = {
	value: string;
	onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
	onSubmit: () => void;
	onStop: () => void;
	/** A session is running: with nothing typed, ↑ becomes Stop. */
	isLoading: boolean;
	/** The send button works with nothing typed (it starts a session). */
	allowEmpty?: boolean;
	sendDisabled?: boolean;
	sendTitle?: string;
	placeholder?: string;
	modelPicker?: Picker;
	effortPicker?: Picker;
	/** The chips under the card: Start or Resume, the item in focus, attachments. */
	context?: React.ReactNode;
	/** More controls beside the Thinking pill (Draft reply). */
	extra?: React.ReactNode;
	textareaRef?: React.Ref<HTMLTextAreaElement>;
};

/** AffectUI's colours, taken from the app's theme so the composer follows light and dark mode. */
const theme = /* css */ `
.ui-chat-composer.fm {
  --ui-cc-tray: hsl(var(--muted));
  --ui-cc-card: hsl(var(--card));
  --ui-cc-line: hsl(var(--border));
  --ui-cc-ink: hsl(var(--foreground));
  --ui-cc-ink-muted: hsl(var(--muted-foreground));
  --ui-cc-ink-hover: hsl(var(--foreground));
  --ui-cc-ink-faint: hsl(var(--muted-foreground));
  --ui-cc-placeholder: hsl(var(--muted-foreground) / 0.7);
  --ui-cc-on-ink: hsl(var(--background));
  --ui-cc-menu-fill: hsl(var(--accent));
  --ui-cc-square-hover: hsl(var(--accent));
  --ui-cc-focus: hsl(var(--ring) / 0.35);
  max-width: none;
}
.ui-chat-composer.fm .fm-cc-context {
  position: absolute;
  left: calc(84 * var(--u) + var(--ui-cc-inset));
  right: calc(84 * var(--u) + var(--ui-cc-inset));
  top: calc((var(--ui-cc-card-h) + 20) * var(--u) + var(--ui-cc-inset) * 1.5);
  height: calc(130 * var(--u));
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  font-size: 12px;
  transition: top var(--ui-cc-swap) var(--ui-cc-ease-swap);
}
/* The app's own text size (the file tree's: 14px on 20px lines), not AffectUI's width-scaled type. */
.ui-chat-composer.fm .ui-chat-composer__message,
.ui-chat-composer.fm .ui-chat-composer__draft { font-size: 14px; line-height: 20px; letter-spacing: normal; }
.ui-chat-composer.fm .ui-chat-composer__label,
.ui-chat-composer.fm .ui-chat-composer__option-name { font-size: 14px; line-height: 20px; letter-spacing: normal; }
.ui-chat-composer.fm .fm-cc-context { font-size: 14px; }
/* The app's own controls in the toolbar (Draft reply) keep the same size: AffectUI's buttons inherit its larger type. */
.ui-chat-composer.fm .ui-chat-composer__toolbar > :not(.ui-chat-composer__model):not(.ui-chat-composer__send) { font-size: 14px; line-height: 20px; }
/* Smaller than AffectUI's default: its unit grows with the width up to 0.27px; here up to 0.2px. */
.ui-chat-composer.fm .ui-chat-composer__body { --u: min(calc(100cqw / var(--ui-cc-span, 1900)), 0.2px); }
/* A pill fits its whole name (a model's), rather than AffectUI's width cut to the unit. */
.ui-chat-composer.fm .ui-chat-composer__model-name { max-width: 14rem; }
/* Menu rows as tight as the app's menus. */
.ui-chat-composer.fm .ui-chat-composer__option { min-height: 32px; padding-block: 6px; }
/* Optically centred: the triangle's centroid (a third in from its flat side), not its box, sits on the centre. */
.ui-chat-composer.fm .fm-cc-play { width: 46%; height: 46%; fill: var(--ui-cc-on-ink); }
.ui-chat-composer.fm .fm-cc-stop { width: 38%; height: 38%; border-radius: 2px; background: var(--ui-cc-on-ink); }
`;

const asModel = (o: { value: string; label: string }): ChatModel => ({ id: o.value, name: o.label, description: "" });

/** A model or Thinking pill with AffectUI's menu. */
function Pill({ picker, container }: { picker: Picker; container: React.RefObject<HTMLElement | null> }) {
	const [open, setOpen] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const models = picker.options.map(asModel);
	const selected = models.find((m) => m.id === picker.value) ?? models[0];
	if (!selected) return null;
	return (
		<>
			<button
				ref={button}
				type="button"
				className="ui-chat-composer__model"
				aria-haspopup="listbox"
				aria-expanded={open}
				disabled={picker.disabled}
				onClick={() => setOpen((o) => !o)}
			>
				<span className="ui-chat-composer__model-face">
					<span className="ui-chat-composer__label ui-chat-composer__model-name" title={selected.name}>
						{selected.name}
					</span>
				</span>
				<span className="ui-chat-composer__icon ui-chat-composer__icon--chevron" aria-hidden="true">
					<ChevronIcon />
				</span>
			</button>
			{/* Outside the card, as AffectUI places it: the card clips, so a menu inside it is cut off. */}
			{container.current ? createPortal(<ModelMenu
				open={open}
				models={models}
				selected={selected}
				anchor={button}
				container={container}
				onPick={(m) => {
					setOpen(false);
					picker.onChange(m.id);
					button.current?.focus();
				}}
				onClose={(refocus) => {
					setOpen(false);
					if (refocus) button.current?.focus();
				}}
			/>, container.current) : null}
		</>
	);
}

/**
 * The swarm chat's composer on AffectUI's Chat Composer: the same card, pills and menu, driven by the app's props
 * (a controlled value, Enter to send, ↑ that starts or sends and is Stop while a session runs with nothing typed),
 * with the context chips in the strip under the card.
 */
export function Composer({ value, onChange, onSubmit, onStop, isLoading, allowEmpty, sendDisabled, sendTitle, placeholder, modelPicker, effortPicker, context, extra, textareaRef }: ComposerProps) {
	const body = useRef<HTMLElement>(null);
	const own = useRef<HTMLTextAreaElement | null>(null);
	const [lines, setLines] = useState(1);
	useLayoutEffect(() => {
		const el = own.current;
		if (!el) return;
		const prev = el.style.height;
		el.style.height = "0px";
		const content = el.scrollHeight;
		el.style.height = prev;
		const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 1;
		setLines(Math.min(2, Math.max(1, Math.round(content / lineHeight))));
	}, [value]);
	const typed = value.trim().length > 0;
	// One button for the session: Start (nothing running, nothing typed), Send, or Stop (running, nothing typed).
	const stop = isLoading && !typed;
	const start = !isLoading && !typed;
	const canSend = !sendDisabled && (stop || typed || allowEmpty);
	const go = () => {
		if (!canSend) return;
		if (stop) onStop();
		else onSubmit();
	};
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			if (typed || allowEmpty) go();
		}
	};
	const focus = (e: PointerEvent<HTMLDivElement>) => {
		if ((e.target as HTMLElement).closest("button, textarea, input")) return;
		e.preventDefault();
		own.current?.focus();
	};
	const setRef = (el: HTMLTextAreaElement | null) => {
		own.current = el;
		if (typeof textareaRef === "function") textareaRef(el);
		else if (textareaRef) (textareaRef as React.RefObject<HTMLTextAreaElement | null>).current = el;
	};
	return (
		<div className="ui-chat-composer fm">
			<style href="ui-chat-composer" precedence="default">
				{css}
			</style>
			<style href="fm-chat-composer" precedence="default">
				{theme}
			</style>
			<section ref={body} className="ui-chat-composer__body" data-apps="idle" data-approval="idle" style={{ "--ui-cc-grow": (lines - 1) * 106.424 } as CSSProperties} aria-label="Message composer">
				<div className="ui-chat-composer__tray">{context ? <div className="fm-cc-context">{context}</div> : null}</div>
				<div className="ui-chat-composer__card" onPointerDown={focus}>
					<textarea ref={setRef} className="ui-chat-composer__message" value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} aria-label="Message" spellCheck={false} dir="auto" />
					<div className="ui-chat-composer__draft" aria-hidden="true" dir="auto">
						{value}
					</div>
					<div className="ui-chat-composer__toolbar">
						{effortPicker ? <Pill picker={effortPicker} container={body} /> : null}
						{extra}
					</div>
					<div className="ui-chat-composer__toolbar ui-chat-composer__toolbar--end">
						{modelPicker ? <Pill picker={modelPicker} container={body} /> : null}
						<button type="button" className="ui-chat-composer__send" data-stop={stop || undefined} aria-label={sendTitle ?? (stop ? "Stop" : "Send")} title={sendTitle} disabled={!canSend} onClick={go}>
							{stop ? <span className="fm-cc-stop" /> : start ? <svg className="fm-cc-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.4v9.2a.8.8 0 0 0 1.2.7l7-4.6a.8.8 0 0 0 0-1.4l-7-4.6a.8.8 0 0 0-1.2.7Z" /></svg> : <ArrowUpIcon />}
						</button>
					</div>
				</div>
			</section>
		</div>
	);
}

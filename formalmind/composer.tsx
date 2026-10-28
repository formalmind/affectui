import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowUpIcon, ChevronIcon, ModelMenu, css, type ChatModel } from "../components/chat-composer-clean";

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

/** AffectUI's colours (its clean theme), taken from the app's theme so the composer follows light and dark mode. */
const theme = /* css */ `
.ui-ccc.fm {
  --ui-ccc-card: hsl(var(--card));
  --ui-ccc-strong: hsl(var(--foreground));
  --ui-ccc-ink: hsl(var(--foreground));
  --ui-ccc-text: hsl(var(--muted-foreground));
  --ui-ccc-muted: hsl(var(--muted-foreground));
  --ui-ccc-faint: hsl(var(--muted-foreground) / 0.6);
  --ui-ccc-icon: hsl(var(--muted-foreground));
  --ui-ccc-line: hsl(var(--border));
  --ui-ccc-fill: hsl(var(--muted));
  --ui-ccc-wash: hsl(var(--accent));
  --ui-ccc-solid: hsl(var(--foreground));
  --ui-ccc-on-solid: hsl(var(--background));
  --ui-ccc-focus: hsl(var(--ring) / 0.35);
  --ui-ccc-shadow: 0 0 0 0.5px hsl(var(--border)), 0 1px 2px 0 rgb(0 0 0 / 0.05);
  max-width: none;
}
.ui-ccc.fm .ui-ccc__body { font-family: inherit; border-radius: 16px; }
.ui-ccc.fm .ui-ccc__message::placeholder { color: hsl(var(--muted-foreground) / 0.7); }
/* The app's own controls (Draft reply) in the toolbar, at the composer's size. */
.ui-ccc.fm .ui-ccc__group > :not(.ui-ccc__model):not(.ui-ccc__send) { font-size: 13px; line-height: 20px; }
/* The context chips (the folder) in the foot row. */
.ui-ccc.fm .ui-ccc__foot { display: flex; align-items: center; gap: 8px; font-size: 12px; }
/* A pill fits its whole name (a model's). */
.ui-ccc.fm .ui-ccc__model-name { max-width: 14rem; }
/* Optically centred: the triangle's centroid (a third in from its flat side), not its box, sits on the centre. */
.ui-ccc.fm .fm-cc-play { width: 46%; height: 46%; fill: var(--ui-ccc-on-solid); }
.ui-ccc.fm .fm-cc-stop { width: 38%; height: 38%; border-radius: 2px; background: var(--ui-ccc-on-solid); }
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
				className="ui-ccc__model"
				aria-haspopup="listbox"
				aria-expanded={open}
				disabled={picker.disabled}
				onClick={() => setOpen((o) => !o)}
			>
				<span className="ui-ccc__model-face">
					<span className="ui-ccc__model-name" title={selected.name}>
						{selected.name}
					</span>
				</span>
				<span className="ui-ccc__chevron" aria-hidden="true">
					<ChevronIcon />
				</span>
			</button>
			{/* Outside the card: the card clips, so a menu inside it is cut off. */}
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
 * The swarm chat's composer on AffectUI's Chat Composer (its clean theme): the same card, pills and menu, driven by
 * the app's props (a controlled value, Enter to send, ↑ that starts or sends and is Stop while a session runs with
 * nothing typed), with the context chips in its foot row.
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
		setLines(Math.min(6, Math.max(1, Math.round(content / lineHeight))));
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
		<div className="ui-ccc fm">
			<style href="ui-chat-composer-clean" precedence="default">
				{css}
			</style>
			<style href="fm-chat-composer-clean" precedence="default">
				{theme}
			</style>
			<section ref={body} className="ui-ccc__body" data-apps="idle" data-approval="idle" style={{ "--ui-ccc-lines": lines } as CSSProperties} aria-label="Message composer">
				<div className="ui-ccc__write" onPointerDown={focus}>
					<div className="ui-ccc__field">
						<textarea ref={setRef} className="ui-ccc__message" value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} aria-label="Message" spellCheck={false} dir="auto" />
						<div className="ui-ccc__draft" aria-hidden="true" dir="auto">
							{value}
						</div>
					</div>
					<div className="ui-ccc__tools">
						<div className="ui-ccc__group">
							{effortPicker ? <Pill picker={effortPicker} container={body} /> : null}
							{extra}
						</div>
						<div className="ui-ccc__group ui-ccc__group--end">
							{modelPicker ? <Pill picker={modelPicker} container={body} /> : null}
							<button type="button" className="ui-ccc__send" data-stop={stop || undefined} aria-label={sendTitle ?? (stop ? "Stop" : "Send")} title={sendTitle} disabled={!canSend} onClick={go}>
								{stop ? <span className="fm-cc-stop" /> : start ? <svg className="fm-cc-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.4v9.2a.8.8 0 0 0 1.2.7l7-4.6a.8.8 0 0 0 0-1.4l-7-4.6a.8.8 0 0 0-1.2.7Z" /></svg> : <ArrowUpIcon />}
							</button>
						</div>
					</div>
				</div>
				{context ? <div className="ui-ccc__foot">{context}</div> : null}
			</section>
		</div>
	);
}

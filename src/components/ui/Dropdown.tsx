import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus } from "lucide-react";
import { clsx } from "clsx";
import { T, useCopy } from "../../app/copy";

// The app's only dropdown (FLOW-259). Every screen draws its menus with it, never
// the browser's native select element: tests/dropdown.test.tsx and the lint rule fail
// on a raw one. Options come from `options` or from native-style <option> children (their
// text stays plain, as native option labels are out of live-copy scope), and
// onChange gets a select-like event, so `onChange={(e) => set(e.target.value)}`
// keeps working. The list opens in a portal under the trigger (above it near the
// bottom of the screen), so a scrolling table never clips it.
//
// Semantics follow the select-only combobox pattern: the trigger is a <button
// role="combobox"> that keeps focus and points at the active option with
// aria-activedescendant; the list is role="listbox" with role="option" rows.

export type DropdownVariant = "filter" | "pill" | "field" | "dark";

export type DropdownOption = {
  value: string;
  label: ReactNode;
  // Plain text for type-ahead; derived from label when it is text.
  text?: string;
  disabled?: boolean;
  // The <optgroup> label it sits under; the list shows it as a heading.
  group?: string;
};

export type DropdownChangeEvent = {
  target: { value: string; name: string; selectedOptions: { value: string }[] };
  currentTarget: { value: string; name: string; selectedOptions: { value: string }[] };
};

type Common = {
  options?: DropdownOption[];
  // <option value="…">Label</option> children, as for a native select.
  children?: ReactNode;
  variant?: DropdownVariant;
  // A colored pill for an option value (e.g. "status-pill--closing", or a badge
  // tone "badge success"). Options and the pill trigger render in it.
  pill?: (value: string) => string | undefined;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  title?: string;
  autoFocus?: boolean;
  placeholder?: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "data-testid"?: string;
  onBlur?: () => void;
  onOpenChange?: (open: boolean) => void;
  // FLOW-262: an "Add" box at the bottom of the list. Shown only when given.
  creatable?: {
    label?: ReactNode;
    // Resolves to the new option's value, which is then selected.
    onCreate: (name: string) => Promise<string | void> | string | void;
  };
};

export type DropdownProps = Common &
  (
    | {
        multiple?: false;
        value?: string | number;
        defaultValue?: string | number;
        onChange?: (event: DropdownChangeEvent) => void;
        onValueChange?: (value: string) => void;
      }
    | {
        multiple: true;
        value: string[];
        defaultValue?: undefined;
        onChange?: (event: DropdownChangeEvent) => void;
        onValueChange?: (value: string[]) => void;
      }
  );

export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

// <option> (and fragments or arrays of them) to options; other nodes are ignored.
export function optionsFromChildren(children: ReactNode, group?: string): DropdownOption[] {
  const out: DropdownOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>;
    if (element.type === Fragment) {
      out.push(...optionsFromChildren(element.props.children, group));
      return;
    }
    if (element.type === "optgroup") {
      out.push(...optionsFromChildren(element.props.children, element.props.label ?? ""));
      return;
    }
    if (element.type !== "option") return;
    const label = element.props.children;
    const text = nodeText(label);
    out.push({
      value: element.props.value === undefined ? text : String(element.props.value),
      label,
      text,
      disabled: element.props.disabled,
      group,
    });
  });
  return out;
}

const changeEvent = (value: string, name: string, selected: string[]): DropdownChangeEvent => {
  const target = { value, name, selectedOptions: selected.map((option) => ({ value: option })) };
  return { target, currentTarget: target };
};

type Position = { top: number; left: number; minWidth: number; maxHeight: number; up: boolean };
const LIST_MAX = 300;
const GAP = 4;

function place(trigger: HTMLElement, list: HTMLElement | null): Position {
  const rect = trigger.getBoundingClientRect();
  const height = Math.min(list?.scrollHeight ?? LIST_MAX, LIST_MAX);
  const below = window.innerHeight - rect.bottom - GAP;
  const above = rect.top - GAP;
  const up = below < height && above > below;
  const maxHeight = Math.max(120, Math.min(LIST_MAX, (up ? above : below) - 8));
  const minWidth = Math.max(rect.width, 160);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - minWidth - 8));
  return {
    top: up ? rect.top - GAP : rect.bottom + GAP,
    left,
    minWidth,
    maxHeight,
    up,
  };
}

export function Dropdown(props: DropdownProps) {
  const {
    options: given,
    children,
    variant = "field",
    pill,
    disabled = false,
    required,
    name = "",
    id,
    className,
    title,
    autoFocus,
    placeholder,
    creatable,
    onBlur,
    onOpenChange,
  } = props;
  const multiple = props.multiple === true;
  const options = useMemo(() => given ?? optionsFromChildren(children), [given, children]);
  const listId = useId();
  const triggerId = id ?? `${listId}-trigger`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpenState] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<Position | null>(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const typed = useRef({ text: "", at: 0 });
  const addPlaceholder = useCopy("shared.dropdown.add.placeholder", "Add…");

  // Uncontrolled use (defaultValue) keeps its own value, like a native select.
  const [inner, setInner] = useState<string>(
    props.multiple ? "" : String(props.defaultValue ?? options.find((option) => !option.disabled)?.value ?? ""),
  );
  const controlled = props.value !== undefined;
  const value: string = multiple ? "" : controlled ? String(props.value) : inner;
  const values: string[] = multiple ? (props.value as string[]) : [value];
  const selected = options.find((option) => option.value === value);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
      if (!next) {
        setDraft("");
        setCreateError("");
      }
    },
    [onOpenChange],
  );

  const choose = (option: DropdownOption) => {
    if (option.disabled) return;
    if (props.multiple) {
      const next = values.includes(option.value) ? values.filter((v) => v !== option.value) : [...values, option.value];
      props.onChange?.(changeEvent(next[0] ?? "", name, next));
      props.onValueChange?.(next);
      return;
    }
    setOpen(false);
    triggerRef.current?.focus();
    if (option.value === value) return;
    if (!controlled) setInner(option.value);
    props.onChange?.(changeEvent(option.value, name, [option.value]));
    props.onValueChange?.(option.value);
  };

  const openAt = (index?: number) => {
    if (disabled) return;
    const current = options.findIndex((option) => option.value === (multiple ? values[0] : value));
    setActive(index ?? (current >= 0 ? current : firstEnabled(options, 0, 1)));
    setOpen(true);
  };

  // Position under the trigger; follow scroll and resize while open.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => triggerRef.current && setPosition(place(triggerRef.current, listRef.current));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, options.length]);

  // Closes on a click outside the trigger and the list.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, setOpen]);

  // Esc closes only the list. A dialog around it listens for Esc in the capture
  // phase on the document, so the list takes it first, on the window.
  useEffect(() => {
    if (!open) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, listId]);

  const typeAhead = (key: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at > 600 ? key : typed.current.text + key, at: now };
    const query = typed.current.text.toLowerCase();
    const start = open ? active : -1;
    const order = [...options.slice(start + 1), ...options.slice(0, start + 1)];
    const match = order.find((option) => !option.disabled && optionText(option).toLowerCase().startsWith(query));
    if (!match) return;
    const index = options.indexOf(match);
    if (open) setActive(index);
    else openAt(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const key = event.key;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
        event.preventDefault();
        openAt();
      } else if (key === "Home" || key === "End") {
        event.preventDefault();
        openAt(key === "Home" ? firstEnabled(options, 0, 1) : firstEnabled(options, options.length - 1, -1));
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        typeAhead(key);
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const step = key === "ArrowDown" ? 1 : -1;
      setActive((index) => firstEnabled(options, clamp(index + step, options.length), step, index));
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      setActive(key === "Home" ? firstEnabled(options, 0, 1) : firstEnabled(options, options.length - 1, -1));
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (options[active]) choose(options[active]);
    } else if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (key === "Tab") {
      setOpen(false);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeAhead(key);
    }
  };

  const create = async () => {
    const text = draft.trim();
    if (!text || !creatable) return;
    setCreating(true);
    setCreateError("");
    try {
      const created = await creatable.onCreate(text);
      const newValue = created ?? text;
      setDraft("");
      setOpen(false);
      triggerRef.current?.focus();
      if (!controlled && !multiple) setInner(newValue);
      props.onChange?.(changeEvent(newValue, name, [newValue]));
      if (props.multiple) props.onValueChange?.([...values, newValue]);
      else props.onValueChange?.(newValue);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const tone = (optionValue: string) => (pill ? pill(optionValue) : undefined);
  const pillOf = (option: DropdownOption | undefined) => {
    if (!option) return placeholder ?? "";
    const toneClass = tone(option.value);
    return toneClass ? <span className={clsx("fb-select-pill", toneClass)}>{option.label}</span> : option.label;
  };
  const shown = multiple
    ? values.length
      ? options.filter((option) => values.includes(option.value)).map((option, i) => (
          <Fragment key={option.value}>
            {i > 0 && ", "}
            {option.label}
          </Fragment>
        ))
      : placeholder ?? ""
    : selected
      ? pillOf(selected)
      : placeholder ?? "";

  const style: CSSProperties | undefined = position
    ? {
        position: "fixed",
        left: position.left,
        minWidth: position.minWidth,
        maxHeight: position.maxHeight,
        ...(position.up ? { bottom: window.innerHeight - position.top } : { top: position.top }),
        pointerEvents: "auto",
      }
    : { position: "fixed", visibility: "hidden" };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        id={triggerId}
        title={title}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        data-testid={props["data-testid"]}
        data-value={multiple ? values.join(",") : value}
        className={clsx("fb-select", `fb-select--${variant}`, className)}
        onClick={() => (open ? setOpen(false) : openAt())}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (listRef.current?.contains(event.relatedTarget as Node)) return;
          onBlur?.();
        }}
      >
        <span className="fb-select__value">{shown}</span>
        <ChevronDown aria-hidden="true" size={14} className="fb-select__chevron" />
      </button>
      {name && (multiple ? values : [value]).map((v, i) => <input key={i} type="hidden" name={name} value={v} />)}
      {open &&
        createPortal(
          <div
            ref={listRef}
            className={clsx("fb-select-list", `fb-select-list--${variant}`, position?.up && "fb-select-list--up")}
            style={style}
          >
            <div
              id={listId}
              role="listbox"
              aria-label={props["aria-label"]}
              aria-labelledby={props["aria-label"] ? undefined : props["aria-labelledby"] ?? triggerId}
              aria-multiselectable={multiple || undefined}
              tabIndex={-1}
            >
              {segments(options).map((segment) => {
                const rows = segment.items.map(({ option, index }) => {
                  const isSelected = values.includes(option.value);
                  const toneClass = tone(option.value);
                  return (
                    <div
                      key={`${option.value}-${index}`}
                      id={`${listId}-${index}`}
                      data-value={option.value}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      className={clsx("fb-select-option", index === active && "is-active", isSelected && "is-selected")}
                      onPointerMove={() => !option.disabled && setActive(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(option)}
                    >
                      {toneClass ? <span className={clsx("fb-select-pill", toneClass)}>{option.label}</span> : <span>{option.label}</span>}
                      {isSelected && <Check aria-hidden="true" size={14} className="fb-select-option__check" />}
                    </div>
                  );
                });
                return segment.group === undefined ? (
                  <Fragment key={segment.key}>{rows}</Fragment>
                ) : (
                  <div key={segment.key} role="group" aria-label={segment.group}>
                    <div aria-hidden="true" className="fb-select-group">
                      {segment.group}
                    </div>
                    {rows}
                  </div>
                );
              })}
            </div>
            {creatable && (
              <form
                className="fb-select-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void create();
                }}
              >
                <input
                  aria-label="Add option"
                  placeholder={addPlaceholder}
                  data-copy-id="shared.dropdown.add.placeholder"
                  value={draft}
                  maxLength={80}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setOpen(false);
                      triggerRef.current?.focus();
                    }
                  }}
                />
                <button type="submit" disabled={!draft.trim() || creating}>
                  <Plus aria-hidden="true" size={14} />
                  {creatable.label ?? <T id="shared.dropdown.add">Add</T>}
                </button>
                {createError && (
                  <p role="alert" className="fb-select-create__error">
                    {createError}
                  </p>
                )}
              </form>
            )}
          </div>,
          portalHost(triggerRef.current),
        )}
    </>
  );
}

// Inside a modal dialog the list renders in the dialog, so its focus trap and
// outside-click handling treat the list as part of it; elsewhere in <body>.
function portalHost(trigger: HTMLElement | null): HTMLElement {
  return (trigger?.closest('[role="dialog"], [role="alertdialog"]') as HTMLElement | null) ?? document.body;
}
// Runs of options under the same <optgroup> (undefined: not in one).
function segments(options: DropdownOption[]) {
  const out: { key: string; group: string | undefined; items: { option: DropdownOption; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const last = out[out.length - 1];
    if (last && last.group === option.group) last.items.push({ option, index });
    else out.push({ key: `segment-${index}`, group: option.group, items: [{ option, index }] });
  });
  return out;
}
function optionText(option: DropdownOption): string {
  return option.text ?? nodeText(option.label);
}
function clamp(index: number, length: number) {
  return Math.max(0, Math.min(length - 1, index));
}
// The nearest enabled option from `start` in direction `step`; `fallback` if none.
function firstEnabled(options: DropdownOption[], start: number, step: number, fallback = -1): number {
  for (let index = start; index >= 0 && index < options.length; index += step) if (!options[index].disabled) return index;
  return fallback;
}

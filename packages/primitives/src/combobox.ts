/**
 * Select and Combobox — choosing from a list, without and with a textbox.
 *
 * One file, because the two differ by less than they share. Both own a popup
 * listbox, a set of chosen values, virtual focus over the options, typeahead,
 * a real form control behind the scenes, and the same announcements. What
 * separates them is the element the user operates: a button that shows the
 * current value, or a textbox that filters the list as it is typed.
 *
 * This is headless: it owns state, keyboard and ARIA, and returns prop objects
 * to spread onto whatever markup the consumer writes. Nothing here renders.
 *
 *   class Country {
 *     trigger = new Signal.State<Element | null>(null);
 *     list = new Signal.State<Element | null>(null);
 *     native = new Signal.State<Element | null>(null);
 *     select = createSelect({
 *       trigger: () => this.trigger.get(),
 *       listbox: () => this.list.get(),
 *       native: () => this.native.get(),
 *       name: 'country',
 *     });
 *   }
 *
 *   <select :ref="native" :spread="select.nativeProps()">
 *     <option value=""></option>
 *     <option :for="c of countries" :key="c.code"
 *             :spread="select.nativeOptionProps({ value: c.code })">{ c.name }</option>
 *   </select>
 *
 *   <button :ref="trigger" :spread="select.triggerProps()"
 *           :click="select.onTriggerClick()"
 *           :keydown="select.onTriggerKeyDown($event)"
 *           :blur="select.onTriggerBlur()">{ select.displayValue() }</button>
 *
 *   <div :if="select.isPresent()" :portal :ref="list"
 *        :spread="select.listboxProps()"
 *        :click="select.onOptionClick($event)"
 *        :pointerdown="select.onListboxPointerDown($event)"
 *        :pointermove="select.onOptionPointerMove($event)">
 *     <div :for="c of countries" :key="c.code"
 *          :spread="select.optionProps({ value: c.code })">{ c.name }</div>
 *   </div>
 *
 *   <p :spread="select.statusProps()">{ select.status() }</p>
 *
 * Six decisions are worth stating outright, because each has a cost.
 *
 * **Navigation is virtual, never real DOM focus.** The active option is named
 * by `aria-activedescendant` and focus stays on the trigger or in the input for
 * the whole interaction. A combobox has no choice — APG requires the textbox to
 * keep focus so that typing keeps working — and making the select behave the
 * same way is what lets one implementation serve both. The cost is that
 * `createRovingFocus` cannot be used here: it moves focus to the item, which is
 * exactly what must not happen. Its *matching* rule is still shared, because
 * typeahead runs through `collection.match`.
 *
 * **Nothing traps focus.** Focus never enters the popup, so there is nothing to
 * trap and nothing to restore; a focus scope would only fight the input. Every
 * way out — Escape, Tab, choosing an option, a press outside — closes the popup
 * with focus already where it should be.
 *
 * **A real form control sits behind it.** A widget assembled out of `<div>`s
 * submits nothing, validates nothing, and is invisible to `FormData`, to
 * `form.reset()` and to the browser's own required-field handling. So the
 * consumer renders a visually hidden `<select>` or `<input>`, and this keeps it
 * in step. One value goes behind either; several can only go behind a
 * `<select multiple>`, because an `<input>` holds one string — a `multiple`
 * widget backed by one submits the first value chosen and drops the rest,
 * which is the kind of wrong nobody can see in the form data. So a `multiple`
 * widget renders one option per chosen value:
 *
 *   <select :ref="native" :spread="combo.nativeProps()">
 *     <option :for="v of combo.values()" :key="v"
 *             :spread="combo.nativeOptionProps({ value: v })">{ combo.labelOf(v) }</option>
 *   </select>
 *
 * For a select the native options pay for themselves twice over: they are the
 * source typeahead reads while the popup is closed, and they are where the
 * option labels come from when nothing is rendered. A required `<select>` needs
 * an empty first option, or the browser selects the first real one and the
 * field can never be missing.
 *
 * **Escape goes in two stages, popup first.** APG is explicit: Escape dismisses
 * the popup if it is visible, and clears the textbox if it is not. The visible
 * layer is what a user is addressing, and reversing the order would clear text
 * they can still see under a list they wanted rid of.
 *
 * **The empty and loading states are announced.** A list that quietly becomes
 * empty is a list a screen reader user is still being told has options in it.
 * `status()` carries the count, the empty message and the loading message into
 * one polite region, which must be rendered whether or not it has anything to
 * say — a live region that appears together with its message announces nothing.
 *
 * **Every user-visible string is overridable**, through `labels` and through
 * the locale's own catalogue, which is where the defaults come from.
 */

import { Signal, effect, onCleanup } from '@voltdev/core';
import { createAnchor, type Anchor, type AnchorPlacement } from './anchoring.js';
import { createResource, type Resource, type ResourceFetcher } from './async.js';
import { createCollection, ITEM_ATTRIBUTE } from './collection.js';
import { createDismiss, dismissStackSize, type DismissReason } from './dismiss.js';
import { VISUALLY_HIDDEN_INPUT_STYLE } from './form-controls.js';
import { createFormField, type FormField, type FormFieldOptions } from './form-field.js';
import { useLocale, type Locale, type MessageValues } from './i18n.js';
import { createId } from './id.js';
import { createPresence, type PresenceState } from './presence.js';

// The proposal's own name for reading without subscribing; Volt adds no second
// spelling for it.
const { untrack } = Signal.subtle;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A prop object to spread.
 *
 * Attributes and properties, never handlers: a prop object is re-applied
 * whenever the state it reads changes, and a listener in one would be added
 * again on every re-application. Events are wired in the template, where the
 * consumer can see them. `style` is an object because anchoring writes one.
 */
export interface ComboboxProps {
  readonly [key: string]: string | boolean | undefined | Readonly<Record<string, string>>;
}

/** Where virtual focus lands when the popup opens. */
export type ListboxOpenFocus = 'selected' | 'first' | 'last' | 'none';

/**
 * How much the textbox promises about the list.
 *
 * `list` filters the popup, `both` also completes the text inline, and `none`
 * shows every option however much has been typed — which is what a combobox
 * used purely as an opener wants.
 */
export type ComboboxAutocomplete = 'none' | 'list' | 'both';

export interface ListboxOptionOptions {
  /** Identifies the option. Everything else here is keyed off it. */
  value: string;
  /** Skipped by navigation and by typeahead, still announced. */
  disabled?: boolean;
  /**
   * What typeahead, filtering and inline completion match on, when the visible
   * text is not what anyone would type — a label leading with an icon's alt
   * text, or trailing a badge.
   */
  textValue?: string;
}

/**
 * Every string these components can put in front of a user.
 *
 * Each falls back to the locale's catalogue before it falls back to English,
 * so an application that has translated the catalogue has translated these
 * too and need pass nothing here.
 */
export interface ListboxLabels {
  /** Names the popup when no field label does. Default `Suggestions`. */
  listbox?: string;
  /** Shown and announced when nothing matches. Default `No results`. */
  empty?: string;
  /** Announced while an async search is in flight. Default `Loading…`. */
  loading?: string;
  /** Names the button that empties the selection. Default `Clear`. */
  clear?: string;
  /** Names the button that opens the popup. Default `Show suggestions`. */
  toggle?: string;
  /** Names the button that removes one chip. Default `Remove {label}`. */
  remove?: (label: string) => string;
  /** Announced when the popup has options. Default `n results available`. */
  results?: (count: number) => string;
  /** Names the chip list. Default `n selected`. */
  selected?: (count: number) => string;
}

/** Everything a select and a combobox are configured with in common. */
export interface ListboxSharedOptions {
  /** The popup listbox element, once rendered. */
  listbox: () => Element | null | undefined;
  /**
   * The visually hidden `<select>` or `<input>` that submits and validates.
   * Everything works without one except the form.
   */
  native?: () => Element | null | undefined;
  /**
   * The element the popup lines up with, when it is not the trigger or the
   * input — the field wrapper of a combobox with chips, most often. Supplying
   * it moves `anchorProps()` off the control, so spread it on that element
   * yourself.
   */
  anchor?: () => Element | null | undefined;

  /**
   * Supply a signal to control the popup from outside. Without one it owns its
   * own state, which is what most callers want.
   */
  open?: Signal.State<boolean>;
  defaultOpen?: boolean;

  /**
   * Supply a signal to control the value from outside.
   *
   * Always a list, even for a single select: one shape means one code path,
   * and `value()` returns the first entry for the common case.
   */
  value?: Signal.State<readonly string[]>;
  defaultValue?: string | readonly string[];

  /** More than one value at a time. Default false. */
  multiple?: boolean;

  /** Submitted as `name=value`. Without a name the native control submits nothing. */
  name?: string;

  /** Blocks opening and choosing, and is written through to the native control. */
  disabled?: () => boolean;
  /** Blocks choosing but not opening: the values can still be read. */
  readOnly?: () => boolean;
  /** Written through to the native control, so the platform enforces it. */
  required?: () => boolean;

  /** Which side of the anchor the popup sits on. Default `bottom-start`. */
  placement?: AnchorPlacement;
  /** The gap between anchor and popup. A number is pixels. */
  offset?: number | string;
  /** Let the browser flip to the opposite side when it would overflow. Default true. */
  flip?: boolean;

  /**
   * Arrow keys wrap past the ends. Default false, which is what a listbox
   * does: wrapping in a long list of options loses the sense of where the end
   * is, and the End key is the fast way there.
   */
  loop?: boolean;
  /** Choosing an option closes the popup. Defaults to true, or false when `multiple`. */
  closeOnSelect?: boolean;
  /** Escape closes it. Default true. */
  closeOnEscape?: boolean;
  /** A press outside closes it. Default true. */
  closeOnOutsidePointer?: boolean;
  /** How long typed characters accumulate, in ms. Default 500. */
  typeaheadTimeout?: number;

  /**
   * The label, description, error message and validation, handed to
   * `createFormField`. The control and its id are this component's to supply,
   * and `required`, `disabled` and `readOnly` are named above.
   */
  field?: Omit<FormFieldOptions, 'control' | 'id' | 'required' | 'disabled' | 'readOnly'>;

  labels?: ListboxLabels;

  onOpenChange?: (open: boolean) => void;
  onValueChange?: (values: readonly string[]) => void;
}

/** How many options a Page key moves by, per the APG listbox pattern. */
const PAGE = 10;

// ---------------------------------------------------------------------------
// The half a select and a combobox share
// ---------------------------------------------------------------------------

/**
 * The popup, the values, virtual focus, the native control and the
 * announcements — everything neither component needs to know is different.
 *
 * `control` is the element the user operates: the trigger of a select, the
 * textbox of a combobox. It is what the popup is anchored to, what dismissal
 * treats as not-outside, and what carries the field's ARIA.
 */
function createListboxCore(
  options: ListboxSharedOptions,
  control: () => Element | null | undefined,
) {
  const locale = useLocale();

  const controlId = createId('combobox');
  const listboxId = createId('listbox');

  const multiple = options.multiple === true;
  const loop = options.loop === true;
  const closesOnSelect = options.closeOnSelect ?? !multiple;

  const initial = toValues(options.defaultValue);
  const openState = options.open ?? new Signal.State(options.defaultOpen ?? false);
  const valueState = options.value ?? new Signal.State<readonly string[]>(initial);
  const activeValue = new Signal.State<string | null>(null);
  /** How many options the popup is showing, kept for the live region. */
  const optionCount = new Signal.State(0);

  const disabled = () => options.disabled?.() ?? false;
  const readOnly = () => options.readOnly?.() ?? false;
  const required = () => options.required?.() ?? false;

  const presence = createPresence(
    () => openState.get(),
    () => options.listbox(),
  );

  // Options carry `data-volt-item`, so navigation, typeahead and the count all
  // read the same set and can never disagree about what is in the list.
  const items = createCollection(() => options.listbox());

  const anchor = createAnchor({
    anchor: () => options.anchor?.() ?? control(),
    defaultPlacement: options.placement ?? 'bottom-start',
    offset: options.offset,
    flip: options.flip,
  });

  const field = createFormField({
    ...options.field,
    control: () => options.native?.(),
    // The id names the *visible* control, so a `<label for>` moves focus to
    // the thing the user operates rather than to the hidden one behind it.
    id: controlId,
    required,
    disabled,
    readOnly,
  });

  const typeahead = createTypeahead(() => options.typeaheadTimeout ?? 500);

  /**
   * An id per distinct value, minted on demand.
   *
   * `aria-activedescendant` has to name an element, so every option needs an
   * id, and it has to survive the option being re-rendered by a filter. Ids
   * are held for the life of the component: an async search that streams
   * thousands of distinct values keeps one short string each, which is the
   * price of never pointing at an id that has changed under the attribute.
   */
  const optionIds = new Map<string, string>();
  const optionId = (value: string): string => {
    const existing = optionIds.get(value);
    if (existing !== undefined) return existing;
    const minted = createId('option');
    optionIds.set(value, minted);
    return minted;
  };

  /**
   * The last text seen for a value.
   *
   * A chip has to keep its label after the popup that supplied it has gone,
   * and a select has to show one before its popup has ever been opened. The
   * native control answers the second case; this answers the first.
   */
  const labelCache = new Map<string, string>();

  const message = (key: string, fallback: string, values?: MessageValues): string =>
    locale.has(key) ? locale.t(key, values) : fallback;

  // --- values ------------------------------------------------------------

  const valuesNow = (): readonly string[] => untrack(() => valueState.get());

  const setValues = (next: readonly string[]): void => {
    if (sameValues(valuesNow(), next)) return;
    valueState.set(next);
    options.onValueChange?.(next);
  };

  const select = (value: string): void => {
    if (disabled() || readOnly()) return;
    const current = valuesNow();
    if (multiple) {
      if (!current.includes(value)) setValues([...current, value]);
    } else {
      setValues([value]);
    }
    if (closesOnSelect) setOpen(false);
  };

  const deselect = (value: string): void => {
    if (disabled() || readOnly()) return;
    setValues(valuesNow().filter((v) => v !== value));
  };

  const clear = (): void => {
    if (disabled() || readOnly()) return;
    setValues([]);
  };

  // --- opening -----------------------------------------------------------

  /**
   * Where virtual focus should land once the popup exists.
   *
   * Held across the render because the effect below runs after the key that
   * opened the popup has been and gone, and the DOM cannot be asked which one
   * it was.
   */
  let pendingFocus: ListboxOpenFocus = 'none';

  /**
   * Set while an Escape that dismissal has already acted on is still bubbling.
   *
   * Dismissal owns Escape, on the document and in the capture phase, so that
   * one press closes one layer — a combobox inside a dialog must not take the
   * dialog down with it. That handler therefore runs *before* the control's
   * own, which would otherwise see a closed popup and go on to clear the
   * textbox as well. One flag is enough: both handlers run inside the same
   * dispatch, and opening resets it in case a press ever lands with focus
   * somewhere the control's handler never sees.
   */
  let escapeDismissed = false;

  const setOpen = (next: boolean): void => {
    if (untrack(() => openState.get()) === next) return;
    openState.set(next);
    options.onOpenChange?.(next);
  };

  const openListbox = (focus: ListboxOpenFocus = 'selected'): void => {
    if (disabled()) return;
    escapeDismissed = false;
    pendingFocus = focus;
    setOpen(true);
  };

  const close = (): void => setOpen(false);

  // --- virtual focus -----------------------------------------------------

  const optionFor = (value: string | null): HTMLElement | null => {
    if (value === null) return null;
    return items.enabled().find((el) => el.getAttribute('data-value') === value) ?? null;
  };

  const activeOption = (): HTMLElement | null => optionFor(activeValue.get());

  /**
   * Everything on the page that says it controls this popup.
   *
   * A combobox's toggle button sits beside the textbox, inside neither it nor
   * the popup, so dismissal reads a press on it as a press outside: the popup
   * closes and the button's own click opens it again, and it can never close.
   * Read from the document rather than taken as an option, because
   * `aria-controls` is already the statement that the button belongs to this
   * popup — a button that has not made it is one this component cannot vouch
   * for, and an option is one more thing every consumer has to remember.
   */
  const popupControllers = (): Element[] => [
    ...document.querySelectorAll(`[aria-controls="${listboxId}"]`),
  ];

  const setActive = (option: HTMLElement | null): void => {
    if (!option) return;
    activeValue.set(option.getAttribute('data-value'));
    // The option is virtually focused, so nothing scrolls it into view for us.
    // `nearest` is the one that does not move the list when it is already
    // visible, which is what makes pointer and keyboard use agree.
    option.scrollIntoView({ block: 'nearest' });
  };

  const move = (delta: number): void => {
    setActive(items.next(activeOption(), delta, loop));
  };

  const moveTo = (option: HTMLElement | null): void => setActive(option);

  /** Move virtual focus by a typed prefix, matching exactly as a menu does. */
  const typeaheadMove = (key: string): boolean => {
    const match = items.match(typeahead.push(key), activeOption());
    if (match) setActive(match);
    return match !== null;
  };

  const applyPendingFocus = (): void => {
    const focus = pendingFocus;
    pendingFocus = 'none';

    if (focus === 'none') {
      activeValue.set(null);
      return;
    }
    if (focus === 'first') return void setActive(items.first());
    if (focus === 'last') return void setActive(items.last());
    // `selected` falls back to the first option, so opening always has
    // somewhere for the next arrow key to move on from.
    setActive(optionFor(valuesNow()[0] ?? null) ?? items.first());
  };

  /** Cache the text of everything currently rendered, for chips and display. */
  const rememberLabels = (): void => {
    for (const option of items.all()) {
      const value = option.getAttribute('data-value');
      if (value !== null) labelCache.set(value, textOf(option));
    }
  };

  // Everything that only applies while open lives in one effect, so it is set
  // up and torn down as a unit — and, because these register cleanups, in
  // exactly the reverse order on the way out.
  effect(() => {
    if (!openState.get()) return;
    const popup = options.listbox();
    if (!popup) return;

    createDismiss(
      () => options.listbox(),
      (reason: DismissReason) => {
        if (reason === 'escape') {
          // Recorded whether or not this layer closes, because either way the
          // press has been spoken for and must not also clear a textbox.
          escapeDismissed = true;
          if (options.closeOnEscape === false) return;
        }
        if (reason === 'outside-pointer' && options.closeOnOutsidePointer === false) return;
        setOpen(false);
      },
      {
        // Escape is always claimed here and filtered in the callback above, so
        // that a layer configured not to close still stops the press reaching
        // the layer underneath it.
        escape: true,
        outsidePointer: options.closeOnOutsidePointer !== false,
        // The control is not "outside": dismissing on it would close the popup
        // and the control's own handler would open it again. Nor is anything
        // else that claims to control the popup — see `popupControllers`.
        exclude: () => [control(), options.anchor?.(), ...popupControllers()],
      },
    );

    untrack(() => {
      rememberLabels();
      applyPendingFocus();
    });

    onCleanup(() => {
      activeValue.set(null);
      typeahead.clear();
    });
  });

  // --- how many options there are ----------------------------------------

  /**
   * Bumped whenever the rendered list is seen to have changed.
   *
   * The count alone cannot stand in for this: an async answer that replaces
   * one option with a different one changes nothing about the number, and
   * anything waiting on the list — inline completion, most of all — would
   * never hear about it.
   */
  const listRevision = new Signal.State(0);

  // Counted from the DOM, because the list is the consumer's to render and
  // this component is never told what went into it. An observer catches every
  // route — a filter, an async answer, a group appearing — including the ones
  // driven by signals this component cannot see.
  effect(() => {
    if (!openState.get()) {
      optionCount.set(0);
      return;
    }
    const popup = options.listbox();
    if (!popup) return;

    const measure = () => {
      optionCount.set(items.enabled().length);
      listRevision.set(untrack(() => listRevision.get()) + 1);
      // `aria-activedescendant` names an element by id, so an option that
      // leaves the list under an open popup leaves the attribute pointing at
      // nothing. Typing is not the only way that happens — a late search
      // answer, a consumer's own filter and a plain data change never pass
      // through this component at all — so it is caught where the list is
      // watched rather than where the keystrokes are.
      untrack(() => {
        const active = activeValue.get();
        if (active !== null && optionFor(active) === null) activeValue.set(null);
      });
    };
    measure();

    const observer = new MutationObserver(measure);
    observer.observe(popup, {
      childList: true,
      subtree: true,
      attributes: true,
      // Disabled options are not counted, so a disabling is a change of count.
      attributeFilter: ['data-disabled', 'disabled', ITEM_ATTRIBUTE],
    });
    onCleanup(() => observer.disconnect());
  });

  /** Recount now rather than at the end of the microtask the observer waits for. */
  const recount = (): void => {
    if (untrack(() => openState.get())) optionCount.set(items.enabled().length);
  };

  // --- the native control -------------------------------------------------

  /**
   * Follow the values into the native control, and tell the field an edit
   * happened.
   *
   * A `<select>` takes its selectedness from `nativeOptionProps`, which the
   * spread has already applied by the time a user effect runs; an `<input>`
   * has one value and takes it here. Either way the field is told afterwards,
   * so that `isDirty` and any revalidation see the new value rather than the
   * one it replaced.
   *
   * A `multiple` widget behind an `<input>` is the one case with no honest
   * answer: the element holds one string. It is left empty rather than given
   * the first value, because a form that receives one of the three things
   * chosen is wrong in a way nobody can see, while a form that receives
   * nothing fails the required check and says so. The markup that works is a
   * `<select multiple>` — see the note on the form control at the top.
   */
  let firstSync = true;
  effect(() => {
    const values = valueState.get();
    const native = options.native?.();
    if (!native) return;

    untrack(() => {
      if (!isSelectElement(native) && 'value' in native) {
        (native as { value: string }).value = multiple ? '' : (values[0] ?? '');
      }
      if (firstSync) {
        firstSync = false;
        return;
      }
      field.markEdited();
    });
  });

  // A form reset restores the control's default, and a widget that ignored it
  // would leave the page showing a value the form no longer holds.
  effect(() => {
    const native = options.native?.();
    const form = native ? formOf(native) : null;
    if (!form) return;

    // Deferred by a microtask because `reset` is dispatched as part of
    // resetting, before the controls it resets have settled.
    const onReset = () => queueMicrotask(() => setValues(initial));
    form.addEventListener('reset', onReset);
    onCleanup(() => form.removeEventListener('reset', onReset));
  });

  // --- labels and announcements -------------------------------------------

  const labelOf = (value: string): string => {
    const rendered = optionFor(value);
    if (rendered) {
      const text = textOf(rendered);
      labelCache.set(value, text);
      return text;
    }

    const native = options.native?.();
    if (isSelectElement(native)) {
      for (const option of native.options) {
        if (option.value === value) {
          const text = textOf(option);
          labelCache.set(value, text);
          return text;
        }
      }
    }

    // The value itself is a poor label and a good clue: it shows up as the
    // identifier it is, rather than as a blank space nobody can explain.
    return labelCache.get(value) ?? value;
  };

  const emptyMessage = (): string => options.labels?.empty ?? message('noResults', 'No results');

  const loadingMessage = (): string => options.labels?.loading ?? message('loading', 'Loading…');

  const resultsMessage = (count: number): string =>
    options.labels?.results?.(count) ??
    message('resultsAvailable', count === 1 ? '1 result available' : `${count} results available`, {
      n: count,
    });

  // --- props shared by both -----------------------------------------------

  /**
   * What names the popup.
   *
   * The field's label is preferred and only used when an element really
   * carries the id: a dangling `aria-labelledby` announces an unnamed listbox
   * while hiding the fact that the name is missing.
   */
  const listboxName = (): { by: string | undefined; text: string | undefined } => {
    const labelled = options.field?.label?.()?.id;
    if (labelled) return { by: labelled, text: undefined };
    return { by: undefined, text: options.labels?.listbox ?? message('suggestions', 'Suggestions') };
  };

  const listboxProps = (): ComboboxProps => {
    const named = listboxName();
    return {
      ...anchor.floatingProps(),
      id: listboxId,
      role: 'listbox',
      'aria-multiselectable': multiple ? 'true' : undefined,
      'aria-labelledby': named.by,
      'aria-label': named.text,
      // Announce the list once it has settled rather than partway through
      // being rebuilt, which is what a screen reader would otherwise read.
      'aria-busy': undefined,
      'data-state': presence.state(),
      // No tabindex. Focus never enters the popup — the control keeps it for
      // the whole interaction — and a tab stop here would be a place a user
      // could land with nothing to operate.
    };
  };

  const optionProps = (option: ListboxOptionOptions): ComboboxProps => {
    const chosen = valueState.get().includes(option.value);
    return {
      [ITEM_ATTRIBUTE]: '',
      id: optionId(option.value),
      role: 'option',
      // Said on every option, not only the chosen ones: with
      // `aria-multiselectable` the absence of the attribute is a statement
      // about selectability rather than about state.
      'aria-selected': String(chosen),
      // `aria-disabled`, never the `disabled` attribute: a disabled option
      // stays in the accessibility tree, so it can be found and heard to be
      // unavailable rather than appear to have vanished. The `data-` twin is
      // what the collection skips by.
      'aria-disabled': option.disabled ? 'true' : undefined,
      'data-disabled': option.disabled ? '' : undefined,
      'data-value': option.value,
      'data-label': option.textValue,
      'data-state': chosen ? 'checked' : 'unchecked',
      // The highlight is virtual, so CSS has no `:focus` to select on.
      'data-highlighted': activeValue.get() === option.value ? '' : undefined,
    };
  };

  const statusProps = (): ComboboxProps => ({
    // The role and the `aria-live` say the same thing on purpose: the role's
    // implicit value satisfies the specification, and some assistive
    // technology still honours only the explicit attribute.
    //
    // Render this element unconditionally. A live region only announces
    // changes to text inside a region that was already there, so one that
    // appears together with its message is a region that says nothing.
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

  const nativeProps = (): ComboboxProps => {
    const props: Record<string, ComboboxProps[string]> = {
      multiple: multiple || undefined,
      // Reachable to the platform, invisible to assistive technology and to
      // Tab: the visible control carries the role and the tab stop, and
      // announcing both would announce the widget twice.
      tabindex: '-1',
      'aria-hidden': 'true',
      style: VISUALLY_HIDDEN_INPUT_STYLE,
    };
    // Omitted rather than set to undefined: `name` is a property on a form
    // control, and assigning undefined to it submits the string "undefined".
    if (options.name !== undefined) props.name = options.name;
    return props;
  };

  const nativeOptionProps = (option: ListboxOptionOptions): ComboboxProps => ({
    value: option.value,
    selected: valueState.get().includes(option.value),
    disabled: option.disabled === true,
  });

  const anchorProps = (): ComboboxProps => anchor.anchorProps();

  /** Anchoring rides on the control unless the consumer named another element. */
  const controlAnchorProps = (): ComboboxProps =>
    options.anchor ? {} : (anchor.anchorProps() as ComboboxProps);

  const onOptionClick = (event: MouseEvent): void => {
    const option = optionFrom(event.target);
    if (!option) return;
    if (isDisabled(option)) {
      // A disabled option still swallows the press: it is visibly there, and
      // an `<a>` used as an option would otherwise follow its href.
      event.preventDefault();
      return;
    }
    const value = option.getAttribute('data-value');
    if (value === null) return;
    labelCache.set(value, textOf(option));
    if (multiple) {
      if (valuesNow().includes(value)) deselect(value);
      else select(value);
    } else {
      select(value);
    }
  };

  const onOptionPointerMove = (event: PointerEvent): void => {
    const option = optionFrom(event.target);
    // Pointer *move* rather than enter, because a popup that opens under a
    // stationary cursor, or scrolls beneath it, never fires enter — and moving
    // within an option fires this many times, hence the check.
    if (!option || isDisabled(option) || option.getAttribute('data-value') === activeValue.get()) {
      return;
    }
    setActive(option);
  };

  const onListboxPointerDown = (event: PointerEvent): void => {
    // Keeps focus where it is. An option is not focusable, so in practice the
    // browser leaves focus alone — but a consumer who makes one focusable, or
    // a scrollbar drag inside the popup, would otherwise take it off the
    // control and close the popup out from under the press.
    event.preventDefault();
  };

  return {
    locale,
    controlId,
    listboxId,
    multiple,
    closesOnSelect,
    anchor,
    field,
    items,
    presence,
    openState,
    valueState,
    activeValue,
    optionCount,
    listRevision,
    typeahead,
    escape: {
      /** Whether dismissal has already answered the Escape now bubbling. */
      consume(): boolean {
        if (!escapeDismissed) return false;
        escapeDismissed = false;
        return true;
      },
    },
    disabled,
    readOnly,
    required,
    valuesNow,
    setValues,
    select,
    deselect,
    clear,
    setOpen,
    openListbox,
    close,
    optionFor,
    activeOption,
    setActive,
    move,
    moveTo,
    typeaheadMove,
    rememberLabels,
    recount,
    labelOf,
    emptyMessage,
    loadingMessage,
    resultsMessage,
    message,
    listboxProps,
    optionProps,
    statusProps,
    nativeProps,
    nativeOptionProps,
    anchorProps,
    controlAnchorProps,
    onOptionClick,
    onOptionPointerMove,
    onListboxPointerDown,
  };
}

type ListboxCore = ReturnType<typeof createListboxCore>;

/** The parts of the public surface both components spell identically. */
interface ListboxCommon {
  /** The field this composes: label, description, validation, dirty and touched. */
  readonly field: FormField;
  /** The anchor this composes, for a consumer who wants to move the popup. */
  readonly anchor: Anchor;

  /** Whether the popup is logically open. */
  isOpen(): boolean;
  /** Whether the popup should be in the DOM — stays true during exit. */
  isPresent(): boolean;
  /** `open` or `closed`, for CSS to animate against. */
  state(): PresenceState;

  /** The first chosen value, or null. */
  value(): string | null;
  /** Every chosen value, in the order they were chosen. */
  values(): readonly string[];
  hasValue(): boolean;
  isSelected(value: string): boolean;
  /** The text last seen for a value, falling back to the value itself. */
  labelOf(value: string): string;
  /** Every chosen label, joined the way the locale joins a list. */
  displayValue(): string;

  /** The value holding virtual focus, or null. */
  activeValue(): string | null;
  /** The option holding virtual focus, for a consumer who needs the element. */
  activeOption(): HTMLElement | null;

  /** How many options the popup is showing. */
  optionCount(): number;
  /** Open, settled, and showing nothing. */
  isEmpty(): boolean;
  /** What the polite live region should be saying right now, or ''. */
  status(): string;
  /** The empty message, for rendering inside the popup as well as announcing it. */
  emptyMessage(): string;

  open(focus?: ListboxOpenFocus): void;
  close(): void;
  toggle(): void;
  select(value: string): void;
  deselect(value: string): void;
  /** Add or remove, which is what a press on an option in a multiple does. */
  toggleValue(value: string): void;
  clear(): void;
  /** Move virtual focus, for a consumer driving it from elsewhere. */
  setActiveValue(value: string | null): void;

  onOptionClick(event: MouseEvent): void;
  onOptionPointerMove(event: PointerEvent): void;
  onListboxPointerDown(event: PointerEvent): void;

  listboxProps(): ComboboxProps;
  optionProps(option: ListboxOptionOptions): ComboboxProps;
  /** `role="group"`, named by its own label rather than by an id pair. */
  groupProps(label: string): ComboboxProps;
  /** For the visible heading of a group, which its `aria-label` already carries. */
  groupLabelProps(): ComboboxProps;
  separatorProps(): ComboboxProps;
  nativeProps(): ComboboxProps;
  nativeOptionProps(option: ListboxOptionOptions): ComboboxProps;
  statusProps(): ComboboxProps;
  /** For the element the popup lines up with, when it is not the control. */
  anchorProps(): ComboboxProps;
  /** For a button that empties the selection. */
  clearProps(): ComboboxProps;
}

/** The half of the surface that is written once and used by both. */
function commonSurface(core: ListboxCore): ListboxCommon {
  return {
    field: core.field,
    anchor: core.anchor,

    isOpen: () => core.openState.get(),
    isPresent: () => core.presence.isPresent(),
    state: () => core.presence.state(),

    value: () => core.valueState.get()[0] ?? null,
    values: () => core.valueState.get(),
    hasValue: () => core.valueState.get().length > 0,
    isSelected: (value) => core.valueState.get().includes(value),
    labelOf: core.labelOf,
    displayValue: () => {
      const labels = core.valueState.get().map(core.labelOf);
      if (labels.length === 0) return '';
      if (labels.length === 1) return labels[0] ?? '';
      // "A, B and C" in English, and whatever the locale does instead.
      return core.locale.format.list(labels);
    },

    activeValue: () => core.activeValue.get(),
    activeOption: () => core.activeOption(),

    optionCount: () => core.optionCount.get(),
    isEmpty: () => core.openState.get() && core.optionCount.get() === 0,
    status: () => '',
    emptyMessage: core.emptyMessage,

    open: (focus) => core.openListbox(focus),
    close: core.close,
    toggle: () => (core.openState.get() ? core.close() : core.openListbox()),
    select: core.select,
    deselect: core.deselect,
    toggleValue: (value) => {
      if (core.valuesNow().includes(value)) core.deselect(value);
      else core.select(value);
    },
    clear: core.clear,
    setActiveValue: (value) => {
      if (value === null) core.activeValue.set(null);
      else core.setActive(core.optionFor(value));
    },

    onOptionClick: core.onOptionClick,
    onOptionPointerMove: core.onOptionPointerMove,
    onListboxPointerDown: core.onListboxPointerDown,

    listboxProps: core.listboxProps,
    optionProps: core.optionProps,
    groupProps: (label) => ({ role: 'group', 'aria-label': label }),
    // The group's `aria-label` already says this, so the heading is decoration
    // here. The alternative — an id pair — needs a key per group from the
    // consumer, and a group whose heading is read twice is the usual result.
    groupLabelProps: () => ({ 'aria-hidden': 'true' }),
    // Not `role="separator"`: a listbox may only contain options and groups,
    // and a separator among them is an error rather than a divider.
    separatorProps: () => ({ role: 'presentation', 'aria-hidden': 'true' }),
    nativeProps: core.nativeProps,
    nativeOptionProps: core.nativeOptionProps,
    statusProps: core.statusProps,
    anchorProps: core.anchorProps,
    clearProps: () => ({
      type: 'button',
      // Out of the tab order: it duplicates what Escape and Backspace already
      // do from the control, and a tab stop between the control and the rest
      // of the form is one more thing to step over on every pass.
      tabindex: '-1',
      'aria-label': core.message('clear', 'Clear'),
      'aria-disabled': core.disabled() || core.readOnly() ? 'true' : undefined,
    }),
  };
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectOptions extends ListboxSharedOptions {
  /** The button that shows the value and opens the popup. */
  trigger: () => Element | null | undefined;
}

export interface Select extends ListboxCommon {
  onTriggerKeyDown(event: KeyboardEvent): void;
  onTriggerClick(): void;
  onTriggerBlur(): void;

  triggerProps(): ComboboxProps;
}

/**
 * A button showing the current value, and a popup listbox.
 *
 * The trigger carries `role="combobox"` rather than staying a plain button,
 * which is what the APG select-only pattern does: it is the element that owns
 * `aria-expanded`, `aria-controls` and `aria-activedescendant`, and a button
 * role cannot carry the last of those. Render it as a `<button>` all the same —
 * the role is overridden, the behaviour of a button is not.
 *
 * The keyboard map is the APG select-only combobox:
 *
 *   closed  Enter, Space, ArrowDown, ArrowUp   open, virtual focus on the
 *                                              selected option
 *           Alt+ArrowDown                      open with nothing highlighted
 *           Home, End                          open at the first, last option
 *           printable characters               choose the match without opening
 *   open    ArrowDown, ArrowUp                 next, previous option
 *           Home, End                          first, last
 *           PageDown, PageUp                   ten options on
 *           Enter, Space                       choose, close
 *           Alt+ArrowUp                        choose, close
 *           Tab                                choose, close, carry on out
 *           Escape                             close, value unchanged
 *           printable characters               move to the match
 *
 * Typeahead works on the closed trigger because the native `<select>` is a
 * `createCollection` of its own: real options, in DOM order, with the disabled
 * ones already skipped. Without a native control there is nothing to search
 * while the popup is closed, so typing opens it and searches there instead.
 */
export function createSelect(options: SelectOptions): Select {
  const core = createListboxCore(options, options.trigger);
  const common = commonSurface(core);

  // The native control's own options, which exist whether or not the popup
  // does. `value` is the attribute every `<option>` carries, and the collection
  // already skips `[disabled]`.
  const nativeItems = createCollection(() => options.native?.(), { attribute: 'value' });

  /** Choose by typed prefix without opening, the way a native select does. */
  const closedTypeahead = (key: string): boolean => {
    const from = nativeItems
      .enabled()
      .find((el) => el.getAttribute('value') === core.valuesNow()[0]);
    const match = nativeItems.match(core.typeahead.push(key), from ?? null);
    if (!match) return false;
    const value = match.getAttribute('value');
    if (value === null) return false;
    core.select(value);
    return true;
  };

  const status = (): string => {
    if (!core.openState.get()) return '';
    const count = core.optionCount.get();
    return count === 0 ? core.emptyMessage() : core.resultsMessage(count);
  };

  const chooseActive = (): void => {
    const value = core.activeValue.get();
    if (value === null) return;
    if (core.multiple) common.toggleValue(value);
    else core.select(value);
  };

  return {
    ...common,
    status,

    onTriggerClick() {
      if (core.disabled()) return;
      if (core.openState.get()) core.close();
      else core.openListbox('selected');
    },

    onTriggerBlur() {
      core.field.markTouched();
    },

    onTriggerKeyDown(event: KeyboardEvent) {
      // A modified key is a shortcut, not navigation. Alt is the exception:
      // it is part of this pattern's own map.
      if (event.ctrlKey || event.metaKey) return;

      const open = core.openState.get();
      const alt = event.altKey;

      switch (event.key) {
        case 'ArrowDown':
          if (!open) core.openListbox(alt ? 'none' : 'selected');
          else if (!alt) core.move(1);
          break;

        case 'ArrowUp':
          if (!open) core.openListbox(alt ? 'none' : 'selected');
          else if (alt) {
            // Alt+Up is the keyboard's "that one, thanks" — it commits and
            // collapses in a single press.
            chooseActive();
            core.close();
          } else core.move(-1);
          break;

        case 'Home':
          if (!open) core.openListbox('first');
          else core.moveTo(core.items.first());
          break;

        case 'End':
          if (!open) core.openListbox('last');
          else core.moveTo(core.items.last());
          break;

        case 'PageDown':
          if (!open) return;
          core.move(PAGE);
          break;

        case 'PageUp':
          if (!open) return;
          core.move(-PAGE);
          break;

        case 'Enter':
          if (!open) core.openListbox('selected');
          else {
            chooseActive();
            core.close();
          }
          break;

        case ' ':
          // A space inside a typeahead run is part of the search — "New " is
          // how you get past "New York" to "New Zealand".
          if (core.typeahead.pending !== '') {
            if (open) core.typeaheadMove(' ');
            else closedTypeahead(' ');
            break;
          }
          if (!open) core.openListbox('selected');
          else {
            chooseActive();
            core.close();
          }
          break;

        case 'Escape':
          // Dismissal has already closed it, in the capture phase. Nothing is
          // left for a select to clear, so the flag is only consumed.
          core.escape.consume();
          return;

        case 'Tab':
          if (!open) return;
          // Not prevented: the popup closes, the highlighted option is taken,
          // and the browser's own Tab carries on from the trigger — which is
          // where a user who tabbed out of a listbox expects to be.
          chooseActive();
          core.close();
          return;

        default: {
          if (!isPrintable(event)) return;
          if (open) core.typeaheadMove(event.key);
          else if (!closedTypeahead(event.key)) {
            // Nothing to search while closed, so search where the options are.
            core.openListbox('selected');
          }
          break;
        }
      }

      // Everything that reaches here was consumed. Arrows and Page keys would
      // scroll the page, Space would too, and Enter would submit the form the
      // trigger is sitting in.
      event.preventDefault();
    },

    triggerProps: () => {
      const open = core.openState.get();
      return {
        ...core.field.controlProps(),
        ...core.controlAnchorProps(),
        role: 'combobox',
        // A `<button>` in a form submits it unless it says otherwise, so
        // without this every pointer press on the trigger submits the form the
        // trigger exists to fill in. The keyboard path prevents the default
        // itself; a click has no default to prevent, only a type to declare.
        type: 'button',
        'aria-haspopup': 'listbox',
        'aria-expanded': String(open),
        'aria-controls': open ? core.listboxId : undefined,
        'aria-activedescendant':
          open && core.activeValue.get() !== null
            ? core.optionProps({ value: core.activeValue.get() ?? '' }).id
            : undefined,
        // In the tab order even when disabled, with `aria-disabled` rather
        // than the `disabled` attribute, because a control a keyboard user
        // cannot reach is a control they cannot discover is there.
        tabindex: '0',
        'data-state': core.presence.state(),
        'data-placeholder': core.valueState.get().length === 0 ? '' : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------

export interface ComboboxOptions<T> extends ListboxSharedOptions {
  /** The textbox the user types in. */
  input: () => Element | null | undefined;

  /** How much the textbox promises about the list. Default `list`. */
  autocomplete?: ComboboxAutocomplete;

  /**
   * Let a value that matches no option be committed on Enter or on blur.
   *
   * Off by default: a combobox that quietly accepts anything is a text field
   * with a list next to it, and the caller has to be able to say which of the
   * two they meant.
   */
  allowCustomValue?: boolean;

  /**
   * Whether an option's text matches what has been typed. Default: a
   * case-insensitive, accent-insensitive substring test in the current locale.
   */
  filter?: (text: string, query: string) => boolean;

  /**
   * Fetch the options for a query. Passed straight to `createResource`, which
   * is what makes a slow answer to an old query unable to land on a new one.
   */
  search?: ResourceFetcher<readonly T[], string>;
  /** Quiet time before a changed query is sent, in ms. Default 250. */
  searchDebounce?: number;
  /** How many times to try again after a failure. Default 0. */
  searchRetry?: number;
  /** Characters before a search goes out at all. Default 1. */
  minLength?: number;

  onInputValueChange?: (value: string) => void;
}

export interface Combobox<T = unknown> extends ListboxCommon {
  /** The resource behind `search`, or null when there is none. */
  readonly search: Resource<readonly T[], string> | null;

  /** What has been typed. The element's own value may be further along — see `autocomplete`. */
  inputValue(): string;
  setInputValue(value: string): void;
  /** Whether the list should be narrowed at all — false until something is typed. */
  isFiltering(): boolean;
  /** Whether an option's text survives the current filter. */
  matches(text: string): boolean;
  /** The last results from `search`, or an empty list. */
  items(): readonly T[];
  isLoading(): boolean;

  /** Take the typed text as the value. Only does anything with `allowCustomValue`. */
  commitCustomValue(): void;

  onInput(event: Event): void;
  onInputKeyDown(event: KeyboardEvent): void;
  onInputClick(): void;
  onInputBlur(): void;
  onToggleClick(): void;
  /** Keeps focus in the textbox when the toggle is pressed. Wire it to `pointerdown`. */
  onTogglePointerDown(event: PointerEvent): void;

  inputProps(): ComboboxProps;
  /**
   * For the button beside the textbox that opens the popup. It needs
   * `onToggleClick` on its click and `onTogglePointerDown` on its pointerdown:
   * without the second the press takes focus out of the textbox.
   */
  toggleProps(): ComboboxProps;
  /** For the list of chips, when `multiple`. */
  chipsProps(): ComboboxProps;
  chipProps(value: string): ComboboxProps;
  removeChipProps(value: string): ComboboxProps;
}

/**
 * A textbox that filters a popup listbox.
 *
 * DOM focus stays in the textbox for the whole interaction — that is the
 * defining constraint of the pattern, and everything else follows from it:
 * virtual focus, `aria-activedescendant`, no focus trap, and a popup that
 * cancels the pointer press that lands on it.
 *
 * The keyboard map is the APG combobox with a listbox popup:
 *
 *   ArrowDown          open with the first option highlighted, then move on
 *   Alt+ArrowDown      open with nothing highlighted
 *   ArrowUp            open with the last option highlighted, then move back
 *   Alt+ArrowUp        close, keeping what is typed
 *   PageDown, PageUp   ten options on, while open
 *   Enter              take the highlighted option; or the typed text, with
 *                      `allowCustomValue`; otherwise let the form have it
 *   Escape             close the popup; and once it is closed, clear the text
 *   Tab                take the highlighted option, close, carry on out
 *   Backspace          on an empty multiple, remove the last chip
 *   Home, End          left alone — in a textbox they belong to the caret
 *   printable          filter, and open if it is not already open
 */
export function createCombobox<T = unknown>(options: ComboboxOptions<T>): Combobox<T> {
  const core = createListboxCore(options, options.input);
  const common = commonSurface(core);

  const autocomplete = options.autocomplete ?? 'list';
  const minLength = options.minLength ?? 1;

  const query = new Signal.State('');
  /**
   * Whether the list should be narrowed.
   *
   * False until something is typed, and false again after a choice, so that
   * reopening a combobox holding "Belgium" shows every country rather than the
   * one already chosen — which is the single most common way this pattern is
   * got wrong.
   */
  const filtering = new Signal.State(false);
  /** Bumped by an insertion, so inline completion runs for typing and not for deletion. */
  const completions = new Signal.State(0);

  const search = options.search
    ? createResource<readonly T[], string>(options.search, {
        source: () => query.get(),
        enabled: () => query.get().length >= minLength,
        debounce: options.searchDebounce ?? 250,
        retry: options.searchRetry ?? 0,
        // The combobox announces the count itself; a resource that also said
        // "Loaded" would talk over it after every keystroke.
        labels: { loading: core.loadingMessage(), success: '' },
      })
    : null;

  const setQuery = (next: string): void => {
    if (untrack(() => query.get()) === next) return;
    query.set(next);
    options.onInputValueChange?.(next);
  };

  const inputElement = (): HTMLInputElement | null => {
    const el = options.input();
    return el && 'value' in el && 'setSelectionRange' in el ? (el as HTMLInputElement) : null;
  };

  const setInputValue = (value: string): void => {
    setQuery(value);
    const el = inputElement();
    // Written straight to the element rather than bound in the template: this
    // owns the textbox's value — it completes it, reverts it and clears it —
    // and a `:value` binding beside that is two writers for one string.
    if (el && el.value !== value) el.value = value;
  };

  const fold = (text: string): string =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase(core.locale.code());

  const defaultFilter = (text: string, typed: string): boolean =>
    fold(text).includes(fold(typed));

  const matches = (text: string): boolean => {
    // `none` means the popup is a plain list that typing does not narrow.
    if (autocomplete === 'none') return true;
    if (!filtering.get()) return true;
    const typed = query.get();
    if (typed === '') return true;
    return (options.filter ?? defaultFilter)(text, typed);
  };

  /** What the textbox should say when nothing is being typed into it. */
  const settledText = (): string => {
    if (core.multiple) return '';
    const value = core.valuesNow()[0];
    return value === undefined ? '' : core.labelOf(value);
  };

  const commitCustomValue = (): void => {
    if (options.allowCustomValue !== true) return;
    const typed = untrack(() => query.get()).trim();
    if (typed === '') return;

    untrack(() => {
      // The box holds the *label* of whatever was chosen, so every blur after
      // a successful pick arrives here with "Cherry" typed and `ch` held —
      // and committing that would replace the option's id with its human text
      // behind the form's back. Compared against the values held rather than
      // against the rendered options, because by the time this runs the popup
      // has usually gone.
      const held = core.valuesNow().some((value) => core.labelOf(value) === typed);
      if (!held) core.select(typed);
      filtering.set(false);
      // Either way the box goes back to saying what is held: the custom value
      // just taken, or the label that was already there.
      setInputValue(settledText());
    });
  };

  const takeOption = (value: string): void => {
    if (core.multiple) {
      common.toggleValue(value);
      // The query has done its job; leaving it would filter the list down to
      // the chip that was just added.
      filtering.set(false);
      setInputValue('');
    } else {
      core.select(value);
      filtering.set(false);
      setInputValue(core.labelOf(value));
    }
  };

  /**
   * Choosing an option has to reach the textbox as well as the value, and a
   * press on an option goes through the core rather than through `takeOption`.
   * Watching the values covers both routes, and the pointer route is the one
   * that would otherwise leave the old query sitting in the box.
   *
   * Nothing is remembered until the textbox exists, so the first pass writes
   * as well as every later one: a `defaultValue` — or a controlled signal that
   * starts full — is not a *change*, and nothing else would ever put it in the
   * box, leaving an empty combobox over a form that holds a value. The element
   * is read as a dependency rather than inside the untracked write below,
   * because this first runs before the template has handed the textbox over.
   */
  let lastValues: readonly string[] | null = null;
  effect(() => {
    const values = core.valueState.get();
    if (!inputElement()) return;
    if (lastValues !== null && sameValues(values, lastValues)) return;
    lastValues = values;
    untrack(() => {
      filtering.set(false);
      setInputValue(settledText());
    });
  });

  /**
   * Complete the textbox from the first option, and select the part the user
   * did not type.
   *
   * Only insertions ask for a completion: completing after a Backspace puts
   * the deleted characters straight back, which makes the field impossible to
   * empty. But the keystroke is not enough to *run* on, because on the first
   * character the popup is opened by the same handler that asks, and nothing
   * is rendered yet when this first passes; an async answer lands later still.
   * So the request stands until the list it needs turns up: the revision the
   * core bumps for every rendered change is the dependency, and `completed`
   * records which keystroke has been answered so a settled list is not
   * re-completed under a caret the user has since moved.
   */
  let completed = 0;
  effect(() => {
    const asked = completions.get();
    core.listRevision.get();
    if (autocomplete !== 'both' || asked === completed) return;

    untrack(() => {
      const typed = query.get();
      const el = inputElement();
      if (!el || typed === '') return;

      const first = core.items.first();
      // Nothing to complete from yet. Left outstanding rather than written
      // off, so the answer still in flight can complete the keystroke that
      // asked for it.
      if (!first) return;
      const text = textOf(first);
      if (!fold(text).startsWith(fold(typed))) return;

      completed = asked;
      el.value = text;
      el.setSelectionRange(typed.length, text.length);
      // The completion is a proposal the user is looking at, so the option it
      // came from is the one Enter should take.
      core.setActive(first);
    });
  });

  // Keep the count honest for the two changes this component makes itself, so
  // the live region does not lag a keystroke behind the list.
  effect(() => {
    query.get();
    search?.data();
    search?.status();
    untrack(() => core.recount());
  });

  const status = (): string => {
    if (!core.openState.get()) return '';
    if (search?.isLoading() === true) return core.loadingMessage();
    if (search?.isError() === true) return search.errorMessage();
    const count = core.optionCount.get();
    return count === 0 ? core.emptyMessage() : core.resultsMessage(count);
  };

  const openFiltered = (focus: ListboxOpenFocus): void => {
    if (core.openState.get()) return;
    // Opening by a means other than typing shows the whole list: the text in
    // the box is a value that has been chosen, not a search in progress.
    filtering.set(false);
    core.openListbox(focus);
  };

  return {
    ...common,
    search,
    status,

    // "Open, settled, and showing nothing" — a search still in flight is not
    // settled, and a popup that flashes "No results" between every keystroke
    // and its answer tells the user something untrue. `status()` has always
    // said the right thing here; the popup's empty state renders from this.
    isEmpty: () =>
      core.openState.get() && search?.isLoading() !== true && core.optionCount.get() === 0,

    inputValue: () => query.get(),
    setInputValue,
    isFiltering: () => filtering.get(),
    matches,
    items: () => search?.data() ?? [],
    isLoading: () => search?.isLoading() ?? false,
    commitCustomValue,

    onInput(event: Event) {
      const target = event.target;
      const typed = target && 'value' in target ? String((target as { value: unknown }).value) : '';
      const grew = typed.length > untrack(() => query.get()).length;

      filtering.set(true);
      // Typing invalidates the highlight: the option it named may not survive
      // the filter, and `aria-activedescendant` must never point at an id that
      // has left the document.
      core.activeValue.set(null);
      setQuery(typed);
      // Typing opens the popup — including a deletion back to empty, where the
      // list is simply unfiltered again.
      core.openListbox('none');
      if (grew) completions.set(untrack(() => completions.get()) + 1);
    },

    onInputClick() {
      // Opens, never closes. A press to reposition the caret in text already
      // typed must not take the list away.
      openFiltered('none');
    },

    onToggleClick() {
      if (core.openState.get()) core.close();
      else openFiltered('selected');
    },

    onTogglePointerDown(event: PointerEvent) {
      // A `tabindex="-1"` button is still click-focusable, so the press would
      // otherwise take focus out of the textbox: `onInputBlur` closes the
      // popup, and the click that follows opens it again — the button would
      // never close anything. Focus staying in the textbox is the pattern's
      // defining constraint, not a convenience.
      event.preventDefault();
    },

    onInputBlur() {
      core.field.markTouched();
      if (options.allowCustomValue === true && !core.multiple) {
        commitCustomValue();
      } else {
        // Whatever is in the box is not a value, so it goes back to being the
        // value that is. Leaving it would show text the form does not hold.
        filtering.set(false);
        setInputValue(settledText());
      }
      core.close();
    },

    onInputKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey) return;

      const open = core.openState.get();
      const alt = event.altKey;

      switch (event.key) {
        case 'ArrowDown':
          if (!open) openFiltered(alt ? 'none' : 'first');
          else if (!alt) core.move(1);
          break;

        case 'ArrowUp':
          if (!open) openFiltered(alt ? 'none' : 'last');
          else if (alt) core.close();
          else core.move(-1);
          break;

        case 'PageDown':
          if (!open) return;
          core.move(PAGE);
          break;

        case 'PageUp':
          if (!open) return;
          core.move(-PAGE);
          break;

        case 'Enter': {
          const value = open ? core.activeValue.get() : null;
          // Closing is the core's decision, and it is the same decision a
          // press on the option makes: `closeOnSelect` defaults to false when
          // `multiple`, and a keyboard that closed anyway would mean reopening
          // the list once per chip.
          if (value !== null) {
            takeOption(value);
            if (core.closesOnSelect) core.close();
            break;
          }
          if (options.allowCustomValue === true && query.get().trim() !== '') {
            commitCustomValue();
            if (core.closesOnSelect) core.close();
            break;
          }
          // Nothing to take. Enter belongs to the form, and swallowing it here
          // is how a combobox stops a one-field form ever being submitted.
          return;
        }

        case 'Escape':
          if (core.escape.consume()) {
            // The popup took this press. The text stays: a user who wanted it
            // gone presses Escape again, which is the stage below.
            event.preventDefault();
            return;
          }
          // A layer this component does not own is still up — a dialog above
          // it, another popup elsewhere — and dismissal has just answered the
          // press on that layer's behalf. One press closes one layer, so this
          // one stands down rather than throwing away text the user can still
          // see under a list they were not addressing. The stack is the only
          // thing that knows; this combobox is collapsed here, so anything on
          // it belongs to somebody else.
          if (dismissStackSize() > 0) return;
          if (query.get() === '' && core.valuesNow().length === 0) return;
          filtering.set(false);
          setInputValue('');
          // A single-value combobox showing nothing holds nothing; a multiple
          // keeps its chips, which Backspace and the chip buttons remove.
          if (!core.multiple) core.clear();
          break;

        case 'Tab':
          if (!open) return;
          if (core.activeValue.get() !== null) takeOption(core.activeValue.get() ?? '');
          core.close();
          return;

        case 'Backspace': {
          // Only on an empty box, so it never eats a character the user meant.
          if (!core.multiple || query.get() !== '') return;
          const last = core.valuesNow().at(-1);
          if (last === undefined) return;
          core.deselect(last);
          return;
        }

        // Home and End are absent on purpose: in a textbox they move the
        // caret, and taking them for the list would break editing the query.

        default:
          return;
      }

      // Everything that reaches here was consumed: the arrows and Page keys
      // would scroll the page or jump the caret, and Enter would submit.
      event.preventDefault();
    },

    inputProps: () => {
      const open = core.openState.get();
      return {
        ...core.field.controlProps(),
        ...core.controlAnchorProps(),
        role: 'combobox',
        type: 'text',
        'aria-haspopup': 'listbox',
        'aria-expanded': String(open),
        'aria-controls': open ? core.listboxId : undefined,
        'aria-activedescendant':
          open && core.activeValue.get() !== null
            ? core.optionProps({ value: core.activeValue.get() ?? '' }).id
            : undefined,
        'aria-autocomplete': autocomplete,
        // The browser's own autofill over a combobox drops a second list on
        // top of this one, and its spellchecker underlines every proper noun
        // in the catalogue.
        autocomplete: 'off',
        spellcheck: false,
        'data-state': core.presence.state(),
      };
    },

    toggleProps: () => ({
      type: 'button',
      // Out of the tab order. The textbox already carries `aria-expanded` and
      // opens from the keyboard, so this button is a pointer affordance; a tab
      // stop for it would be a second way to reach the same state.
      tabindex: '-1',
      'aria-label': options.labels?.toggle ?? core.message('showSuggestions', 'Show suggestions'),
      'aria-expanded': String(core.openState.get()),
      'aria-controls': core.openState.get() ? core.listboxId : undefined,
    }),

    chipsProps: () => {
      const count = core.valueState.get().length;
      return {
        role: 'list',
        'aria-label':
          options.labels?.selected?.(count) ??
          core.message('selected', `${count} selected`, { n: count }),
      };
    },

    chipProps: (value) => ({
      role: 'listitem',
      'data-value': value,
    }),

    removeChipProps: (value) => {
      const label = core.labelOf(value);
      return {
        type: 'button',
        // A tab stop each. The alternative — a roving tabindex over the chips —
        // costs one keyboard pattern the user has to discover, and Backspace
        // from the textbox already covers removing the one just added.
        tabindex: '0',
        'aria-label': options.labels?.remove?.(label) ?? `${core.message('remove', 'Remove')} ${label}`,
        'data-value': value,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The keystroke buffer behind typeahead.
 *
 * `createRovingFocus` owns this for a collection that takes real DOM focus,
 * and cannot be used here: it moves focus to the item it matches, which is
 * precisely what a combobox must never do. What is shared is the part that
 * matters — the matching itself is `collection.match`, so a menu, a select and
 * a combobox all agree on what a typed prefix means.
 */
function createTypeahead(timeout: () => number) {
  let search = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  onCleanup(stop);

  return {
    /** Add a character and return what to search for. */
    push(key: string): string {
      search += key;
      stop();
      timer = setTimeout(() => {
        search = '';
        timer = null;
      }, timeout());

      // Repeating one character walks through the options starting with it,
      // rather than searching for "aaa" — what every native listbox does.
      return search.length > 1 && [...search].every((c) => c === search[0]) ? (search[0] ?? '') : search;
    },
    /** What has accumulated so far, for deciding whether a space is a search. */
    get pending(): string {
      return search;
    },
    clear(): void {
      search = '';
      stop();
    },
  };
}

/** The option an event happened in, allowing for markup inside the option. */
function optionFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}]`);
}

/**
 * The same two attributes the collection skips by, so that navigation and
 * selection can never disagree about what is disabled.
 */
function isDisabled(option: Element): boolean {
  return option.hasAttribute('data-disabled') || option.hasAttribute('disabled');
}

/**
 * The text a user would say this option is.
 *
 * `data-label` wins when present, because an option's visible text may include
 * an icon's alt text, a badge or a count — none of which anyone types when
 * reaching for it. The same rule the collection matches by.
 */
function textOf(el: Element): string {
  return (el.getAttribute('data-label') ?? el.textContent ?? '').trim();
}

function toValues(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Narrow to a native `<select>` by tag name rather than by `instanceof`.
 *
 * An element adopted from another document is not an instance of *this*
 * window's `HTMLSelectElement`, and the constructor is a browser global that
 * does not exist at all on a server, where the check would throw rather than
 * answer. The tag name is true in every one of those cases.
 */
function isSelectElement(el: Element | null | undefined): el is HTMLSelectElement {
  return el?.tagName === 'SELECT';
}

/**
 * The form a control belongs to.
 *
 * The `form` property is the authority, because a control can be associated
 * with a form it is not inside through the `form` attribute; `closest` covers
 * anything that has no such property.
 */
function formOf(control: Element): HTMLFormElement | null {
  const owner = (control as { form?: unknown }).form;
  if (owner && typeof owner === 'object' && 'addEventListener' in owner) {
    return owner as HTMLFormElement;
  }
  return control.closest<HTMLFormElement>('form');
}

/** A single character with no modifier: a search, not a shortcut. */
function isPrintable(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

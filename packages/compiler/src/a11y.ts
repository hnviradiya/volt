/**
 * What the template alone proves about the accessibility of the DOM it builds.
 *
 * The primitives are held to the WAI-ARIA Authoring Practices; nothing holds
 * the `<div :click="select()">` an application author writes to anything. The
 * compiler already rejects a misspelled directive and a `:for` without
 * `:key` — this is that mechanism pointed at a class of bug that stays
 * invisible until somebody tries to use the page with a keyboard.
 *
 * Every rule here decides from markup and nothing else. Two whole categories
 * are therefore absent: anything that needs to know what a bound value is at
 * runtime, and anything about colour. A rule that fires on correct code is
 * worse than no rule, because the first thing it teaches is how to switch the
 * rules off — so wherever the template stops being able to tell (a `:spread`,
 * a component's root element, an id the template computes), the check goes
 * quiet rather than guessing.
 *
 * Severity follows the rest of the compiler: certainly wrong throws, the way
 * markup a parser would rebuild throws, and usually wrong is collected as a
 * warning. Both name what to write instead.
 */

import type {
  AttributeNode,
  ElementNode,
  RootNode,
  TemplateChildNode,
} from './ast.js';
import {
  ARIA_ATTRIBUTES,
  ARIA_ROLES,
  isOneEditFrom,
  type AriaAttribute,
} from './dom-info.js';
import { CompilerError } from './parser.js';

export interface Diagnostic {
  /** What is wrong, and what to write instead. */
  message: string;
  loc: { line: number; column: number };
  filename?: string;
}

/** The line an error prints, so a warning reads like one. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.filename
    ? `${d.filename}:${d.loc.line}:${d.loc.column}`
    : `${d.loc.line}:${d.loc.column}`;
  return `[volt:compiler] ${d.message} (${where})`;
}

/**
 * Events whose whole purpose is to operate the element.
 *
 * Pointer and drag events are deliberately out: a splitter listening on
 * `:pointerdown` is a gesture surface rather than a control, and reporting it
 * would be the false positive that gets the rules turned off.
 */
const ACTIVATION_EVENTS = new Set(['click', 'dblclick', 'keydown', 'keyup', 'keypress']);

/** Roles whose contents the accessibility tree flattens into the name. */
const FLATTENS_CONTENT = new Set([
  'button', 'checkbox', 'img', 'menuitemcheckbox', 'menuitemradio', 'meter', 'option',
  'progressbar', 'radio', 'scrollbar', 'slider', 'switch', 'tab',
]);

/** Roles that make an element a control in its own right. */
const CONTROL_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'gridcell', 'link', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'radio', 'scrollbar', 'searchbox', 'slider', 'spinbutton',
  'switch', 'tab', 'textbox', 'treeitem',
]);

/**
 * Roles an element carries without anyone writing one.
 *
 * Only the tags the rules below actually ask about — `<a>`, `<img>` and
 * `<input>` all depend on an attribute and are worked out in `effectiveRole`.
 */
const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  meter: 'meter',
  option: 'option',
  progress: 'progressbar',
  select: 'combobox',
  textarea: 'textbox',
};

/**
 * Elements whose own role is worth more than one written over it, with the
 * roles that leave that worth intact.
 *
 * An allow-list rather than a deny-list, because the question is not whether a
 * role is unusual but whether the element still does something the new role
 * denies. `role="menuitem"` on `<a href>` is the Authoring Practices' own menu
 * pattern and keeps the link; `role="button"` on the same element leaves a
 * thing that navigates, opens in a new tab, and announces that it does
 * neither.
 */
interface Override {
  tags: string[];
  needsHref?: boolean;
  keeps: string[];
  lost: string;
  why: string;
  remedy: string;
}

const OVERRIDES: Override[] = [
  {
    tags: ['a', 'area'],
    needsHref: true,
    keeps: ['link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem', 'option'],
    lost: 'the link',
    why:
      'The element still navigates, and still offers "open in new tab" from the\n' +
      '  context menu, while announcing itself as something that does neither.',
    remedy:
      'Use `<button>` if it acts on this page, and leave it a link if it goes\n' +
      '  somewhere.',
  },
  {
    tags: ['button'],
    keeps: [
      'button', 'checkbox', 'combobox', 'gridcell', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'option', 'radio', 'switch', 'tab', 'treeitem',
    ],
    lost: 'the button',
    why:
      'The element navigates nowhere, so anyone who follows what the role says and\n' +
      '  expects a new page gets none.',
    remedy: 'Use `<a href>` if it navigates, and leave it a button if it acts.',
  },
  {
    tags: ['main'],
    keeps: ['main'],
    lost: 'the one `main` landmark a page gets',
    why:
      'Skip-to-content and landmark navigation both look for it by role, and now\n' +
      '  find nothing.',
    remedy: 'Put the role on an element inside `<main>` and leave the landmark alone.',
  },
  {
    tags: ['nav'],
    keeps: ['navigation'],
    lost: 'the navigation landmark',
    why: 'Landmark navigation lists this region by role, and now skips it.',
    remedy: 'Put the role on an element inside `<nav>` and leave the landmark alone.',
  },
  {
    tags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    keeps: ['heading', 'presentation', 'none', 'tab', 'treeitem', 'menuitem'],
    lost: 'the heading',
    why:
      'The document outline loses this entry, so navigating by heading goes\n' +
      '  straight past the section it opens.',
    remedy: 'Put the role on an element inside the heading.',
  },
];

interface Context {
  warnings: Diagnostic[];
  /** Every id the template writes out literally. */
  ids: Set<string>;
  /**
   * The template computes an id somewhere, so no reference to a missing one
   * can be ruled out — which id it lands on is a runtime fact.
   */
  idsUnknowable: boolean;
  filename: string | undefined;
}

/** What an element is nested inside that flattens it away, if anything. */
interface Flattened {
  role: string;
  /** How to name the ancestor: its role if written, otherwise its tag. */
  holder: string;
}

export function checkAccessibility(root: RootNode, filename?: string): Diagnostic[] {
  const ctx: Context = { warnings: [], ids: new Set(), idsUnknowable: false, filename };
  collectIds(root.children, ctx);
  walk(root.children, null, ctx);
  return ctx.warnings;
}

/**
 * Every id in the template, gathered before any of it is checked.
 *
 * A `for` or an `aria-labelledby` may name an element written further down, or
 * one sitting on a component's tag, so the set has to be complete before the
 * first reference to it is judged.
 */
function collectIds(nodes: TemplateChildNode[], ctx: Context): void {
  for (const node of nodes) {
    if (node.type !== 'element' && node.type !== 'slot-outlet') continue;
    for (const a of node.attrs) {
      if (a.name.toLowerCase() === 'id' && a.value) ctx.ids.add(a.value);
    }
    for (const d of node.directives) {
      const bindsId = (d.kind === 'prop' || d.kind === 'attr') && d.name.toLowerCase() === 'id';
      if (bindsId || d.kind === 'spread') ctx.idsUnknowable = true;
    }
    collectIds(node.children, ctx);
  }
}

function walk(nodes: TemplateChildNode[], flattened: Flattened | null, ctx: Context): void {
  for (const node of nodes) {
    // Projected content is someone else's markup, but a slot's fallback
    // renders right here and keeps this context.
    if (node.type === 'slot-outlet') {
      walk(node.children, flattened, ctx);
      continue;
    }
    if (node.type !== 'element') continue;

    // A portalled element lands in a container this template knows nothing
    // about, so nothing above it here is above it there.
    if (node.directives.some((d) => d.kind === 'portal')) {
      walk(node.children, null, ctx);
      continue;
    }

    // A component's root element is in another module and a `<template>`
    // contributes no element — but what either renders still lands inside
    // whatever encloses it here.
    if (node.isComponent || node.isTemplate) {
      walk(node.children, flattened, ctx);
      continue;
    }

    check(node, flattened, ctx);
    walk(node.children, flattensContent(node) ?? flattened, ctx);
  }
}

function check(node: ElementNode, flattened: Flattened | null, ctx: Context): void {
  const tag = node.tag.toLowerCase();
  if (flattened) checkFlattened(node, tag, flattened, ctx);
  checkAria(node, ctx);
  checkRole(node, tag, ctx);
  checkTabindex(node, ctx);
  checkImageAlt(node, tag, ctx);
  checkLabelFor(node, tag, ctx);
  checkListener(node, tag, ctx);
}

// ---------------------------------------------------------------------------
// aria-*
// ---------------------------------------------------------------------------

function checkAria(node: ElementNode, ctx: Context): void {
  // A bound `aria-*` hides a misspelling exactly as well as a written one, and
  // the name is knowable either way even where the value is not.
  for (const d of node.directives) {
    if (d.kind !== 'prop' && d.kind !== 'attr') continue;
    const name = d.name.toLowerCase();
    if (name.startsWith('aria-')) ariaSpec(name, d, ctx);
  }

  for (const attr of node.attrs) {
    const name = attr.name.toLowerCase();
    if (!name.startsWith('aria-')) continue;
    checkAriaValue(name, ariaSpec(name, attr, ctx), attr, ctx);
  }
}

function ariaSpec(name: string, at: Located, ctx: Context): AriaAttribute {
  const spec = ARIA_ATTRIBUTES[name];
  if (spec) return spec;

  const meant = Object.keys(ARIA_ATTRIBUTES).find((known) => isOneEditFrom(name, known));
  fail(
    meant
      ? `\`${name}\` is not an ARIA attribute — did you mean \`${meant}\`?\n` +
          '  Nothing reads the name as written, so the state it was meant to carry is\n' +
          '  absent rather than wrong.'
      : `\`${name}\` is not an ARIA attribute, and nothing reads it.\n` +
          '  ARIA is a closed vocabulary, so an invented name is inert.\n' +
          `  Remove it, or write \`data-${name.slice(5)}\` if it is your own.`,
    at,
    ctx,
  );
}

function checkAriaValue(
  name: string,
  spec: AriaAttribute,
  attr: AttributeNode,
  ctx: Context,
): void {
  const raw = attr.value ?? '';

  switch (spec.kind) {
    case 'token': {
      if (spec.values!.includes(raw.trim().toLowerCase())) return;
      fail(
        `\`${name}\` does not take \`${raw}\`.\n` +
          '  A value outside the enumeration is ignored, which leaves the state unset\n' +
          '  rather than wrong — the harder of the two to notice.\n' +
          `  Write ${list(spec.values!)}.`,
        attr,
        ctx,
      );
      return;
    }

    case 'tokens': {
      const bad = raw
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .find((v) => !spec.values!.includes(v));
      if (!bad) return;
      fail(
        `\`${name}\` does not take \`${bad}\`.\n` +
          `  Write ${list(spec.values!)}, separated by spaces.`,
        attr,
        ctx,
      );
      return;
    }

    case 'integer':
    case 'number': {
      const pattern = spec.kind === 'integer' ? /^[+-]?\d+$/ : /^[+-]?(\d+\.?\d*|\.\d+)$/;
      if (pattern.test(raw.trim())) return;
      fail(
        `\`${name}\` takes ${spec.kind === 'integer' ? 'an integer' : 'a number'}, ` +
          `not \`${raw}\`.\n` +
          `  Write \`${name}="1"\`, or bind it with \`:${name}\` if it is computed.`,
        attr,
        ctx,
      );
      return;
    }

    case 'idref':
    case 'idrefs': {
      if (ctx.idsUnknowable) return;
      for (const id of raw.trim().split(/\s+/).filter(Boolean)) {
        if (ctx.ids.has(id)) continue;
        warn(missingId(`\`${name}\``, id, ctx), attr, ctx);
      }
      return;
    }
  }
}

/**
 * The one message both kinds of id reference share.
 *
 * A reference nothing resolves is dropped in silence, and the commonest cause
 * by far is a single character — so a near miss is named where there is one.
 */
function missingId(what: string, id: string, ctx: Context): string {
  const near = [...ctx.ids].find((known) => isOneEditFrom(id, known));
  return (
    `${what} points at \`${id}\`, which no element in this template carries.\n` +
    '  A reference to an id nothing has is dropped, so what it was there to supply\n' +
    '  is missing rather than wrong.\n' +
    (near
      ? `  Did you mean \`${near}\`?`
      : `  Give the element it means \`id="${id}"\`, or point this at one that exists.`)
  );
}

// ---------------------------------------------------------------------------
// role
// ---------------------------------------------------------------------------

/**
 * A role from DPUB-ARIA or Graphics-ARIA, which this compiler does not carry.
 *
 * The prefix is enough: the alternative to accepting `doc-subtitle` unread is
 * rejecting it, and a rule that rejects a real role is the one that gets the
 * whole set switched off.
 */
function isModuleRole(role: string): boolean {
  return role.startsWith('doc-') || role.startsWith('graphics-');
}

function checkRole(node: ElementNode, tag: string, ctx: Context): void {
  const attr = attrOf(node, 'role');
  if (!attr?.value) return;

  // A space-separated value is a fallback chain: the first role a browser
  // knows is the one it uses, so every one of them has to be knowable.
  const roles = attr.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const role of roles) {
    if (ARIA_ROLES.has(role) || isModuleRole(role)) continue;
    const meant = [...ARIA_ROLES].find((known) => isOneEditFrom(role, known));
    fail(
      `\`role="${role}"\` is not an ARIA role${meant ? ` — did you mean \`${meant}\`?` : '.'}\n` +
        '  An unknown role is discarded and the element keeps whatever role its tag\n' +
        '  already gave it, so the markup claims a semantic the page does not have.' +
        (meant ? '' : '\n  Remove it, or write the role the element really has.'),
      attr,
      ctx,
    );
  }

  const role = roles[0]!;

  if ((role === 'presentation' || role === 'none') && isFocusable(node, tag)) {
    fail(
      `\`role="${role}"\` on \`<${tag}>\`, which a keyboard can still focus.\n` +
        '  A browser ignores a presentational role on anything focusable, so the role\n' +
        '  is inert and the element goes on announcing itself.\n' +
        '  Remove the role, or make the element something that is not focusable.',
      attr,
      ctx,
    );
  }

  for (const entry of OVERRIDES) {
    if (!entry.tags.includes(tag)) continue;
    if (entry.needsHref && !has(node, 'href')) continue;
    if (entry.keeps.includes(role)) continue;
    warn(
      `\`role="${role}"\` on \`<${tag}>\` replaces ${entry.lost}.\n` +
        `  ${entry.why}\n` +
        `  ${entry.remedy}`,
      attr,
      ctx,
    );
  }
}

// ---------------------------------------------------------------------------
// tabindex
// ---------------------------------------------------------------------------

function checkTabindex(node: ElementNode, ctx: Context): void {
  const attr = attrOf(node, 'tabindex');
  const value = attr?.value?.trim();
  if (!value || !/^\+?\d+$/.test(value) || Number(value) <= 0) return;

  fail(
    `\`tabindex="${value}"\` puts this element in front of the whole page.\n` +
      '  A positive tabindex is a document-wide ordering rather than a local one:\n' +
      '  every element without one now comes after it, on every page this component\n' +
      '  appears on.\n' +
      '  Write `tabindex="0"` to be focusable where it stands, and move the element if\n' +
      '  it has to come earlier.',
    attr!,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// <img>
// ---------------------------------------------------------------------------

function checkImageAlt(node: ElementNode, tag: string, ctx: Context): void {
  if (tag !== 'img') return;
  // A spread may be carrying the alt, and what it carries is a runtime value.
  if (node.directives.some((d) => d.kind === 'spread')) return;
  if (has(node, 'alt') || has(node, 'aria-label') || has(node, 'aria-labelledby')) return;
  if (attrOf(node, 'aria-hidden')?.value === 'true') return;
  const role = attrOf(node, 'role')?.value?.trim().toLowerCase();
  if (role === 'presentation' || role === 'none') return;

  fail(
    '`<img>` with no `alt`.\n' +
      '  An image with no alternative is announced as its file name, which is worse\n' +
      '  than either saying something or saying nothing.\n' +
      '  Write what the image says. If it says nothing the text beside it does not\n' +
      '  already say, write `alt=""` — an empty alt is an answer, a missing one is\n' +
      '  silence.',
    node,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// <label for>
// ---------------------------------------------------------------------------

function checkLabelFor(node: ElementNode, tag: string, ctx: Context): void {
  if (tag !== 'label' || ctx.idsUnknowable) return;
  const attr = attrOf(node, 'for');
  const target = attr?.value?.trim();
  if (!target || ctx.ids.has(target)) return;

  warn(
    `${missingId('`<label for>`', target, ctx)}\n` +
      '  A label attached to nothing gives its control no name and moves no focus when\n' +
      '  it is clicked. Wrapping the control in the `<label>` needs no id at all.',
    attr!,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

function checkListener(node: ElementNode, tag: string, ctx: Context): void {
  const listener = node.directives.find(
    (d) => d.kind === 'event' && ACTIVATION_EVENTS.has(d.name),
  );
  if (!listener) return;
  if (isInteractive(node, tag)) return;
  // Each of these is the author having already answered the question, and a
  // spread may be carrying any of them.
  if (has(node, 'role') || has(node, 'tabindex') || has(node, 'contenteditable')) return;
  if (node.directives.some((d) => d.kind === 'spread')) return;

  warn(
    `\`${listener.rawName}\` on \`<${tag}>\`, which no keyboard can reach.\n` +
      '  A pointer finds this element and nothing else does: it takes no focus, so the\n' +
      '  handler is unreachable from a keyboard and the element is announced as plain\n' +
      '  text.\n' +
      '  Use `<button>` if it acts, `<a href>` if it navigates, or say what it is with\n' +
      '  a `role` and `tabindex="0"` and handle the keys yourself.',
    listener,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Nesting the ARIA content model forbids
// ---------------------------------------------------------------------------

/** The role an element carries here, written or implied. */
function effectiveRole(node: ElementNode, tag: string): string | null {
  const written = attrOf(node, 'role')?.value?.trim().toLowerCase().split(/\s+/)[0];
  if (written && ARIA_ROLES.has(written)) return written;
  if (tag === 'a' || tag === 'area') return has(node, 'href') ? 'link' : null;
  if (tag === 'input') return inputRole(node);
  // An empty alt is how an image says it is decoration, which is exactly the
  // presentational role.
  if (tag === 'img') return attrOf(node, 'alt')?.value === '' ? 'presentation' : 'img';
  return IMPLICIT_ROLES[tag] ?? null;
}

function inputRole(node: ElementNode): string | null {
  const type = (attrOf(node, 'type')?.value ?? 'text').trim().toLowerCase();
  if (type === 'hidden') return null;
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'range') return 'slider';
  if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') {
    return 'button';
  }
  return 'textbox';
}

function flattensContent(node: ElementNode): Flattened | null {
  const tag = node.tag.toLowerCase();
  const role = effectiveRole(node, tag);
  if (!role || !FLATTENS_CONTENT.has(role)) return null;
  return {
    role,
    holder: attrOf(node, 'role')?.value ? `\`role="${role}"\`` : `\`<${tag}>\``,
  };
}

function checkFlattened(
  node: ElementNode,
  tag: string,
  flattened: Flattened,
  ctx: Context,
): void {
  const role = effectiveRole(node, tag);

  if (role === 'heading') {
    fail(
      `\`<${tag}>\` inside ${flattened.holder}, which flattens everything in it to text.\n` +
        `  A \`${flattened.role}\` announces its contents as its own name, so the heading\n` +
        '  is not in the outline and navigating by heading never reaches it.\n' +
        '  Style a `<span>` to look like a heading, or move the heading outside.',
      node,
      ctx,
    );
  }

  if (!isFocusable(node, tag) && !(role && CONTROL_ROLES.has(role))) return;

  fail(
    `\`<${tag}>\` inside ${flattened.holder}, which flattens everything in it to text.\n` +
      `  A \`${flattened.role}\` announces its contents as its own name, so a control in\n` +
      '  here is read out as part of that name and cannot be operated on its own.\n' +
      `  Make the two siblings — the control beside the \`${flattened.role}\`, not inside\n` +
      '  it.',
    node,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// What an element is
// ---------------------------------------------------------------------------

function attrOf(node: ElementNode, name: string): AttributeNode | undefined {
  return node.attrs.find((a) => a.name.toLowerCase() === name);
}

/** Written out or bound — either way the element has it when it renders. */
function has(node: ElementNode, name: string): boolean {
  if (node.attrs.some((a) => a.name.toLowerCase() === name)) return true;
  return node.directives.some(
    (d) => (d.kind === 'prop' || d.kind === 'attr') && d.name.toLowerCase() === name,
  );
}

/** Reachable and operable from a keyboard with nothing added. */
function isFocusable(node: ElementNode, tag: string): boolean {
  const tabindex = attrOf(node, 'tabindex')?.value?.trim();
  if (tabindex !== undefined && /^\+?\d+$/.test(tabindex)) return true;

  switch (tag) {
    case 'button':
    case 'select':
    case 'textarea':
    case 'summary':
    case 'iframe':
      return true;
    case 'input':
      return (attrOf(node, 'type')?.value ?? 'text').trim().toLowerCase() !== 'hidden';
    case 'a':
    case 'area':
      return has(node, 'href');
    case 'audio':
    case 'video':
      return has(node, 'controls');
    default:
      return false;
  }
}

/** Focusable, or operated by being clicked — a `<label>` forwards its click. */
function isInteractive(node: ElementNode, tag: string): boolean {
  return isFocusable(node, tag) || tag === 'label' || tag === 'option' || tag === 'details';
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface Located {
  loc: { line: number; column: number };
}

function list(values: readonly string[]): string {
  const quoted = values.map((v) => `\`${v}\``);
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

function warn(message: string, at: Located, ctx: Context): void {
  ctx.warnings.push({ message, loc: at.loc, filename: ctx.filename });
}

function fail(message: string, at: Located, ctx: Context): never {
  throw new CompilerError(message, at.loc, undefined, ctx.filename);
}

/**
 * Codegen: template AST -> JavaScript that builds real DOM.
 *
 * There is no virtual DOM anywhere in the output. Each template becomes a
 * static HTML string cloned once per instantiation, plus a small set of
 * targeted effects that patch exactly the nodes that can change.
 *
 * Compile-time work that removes runtime work:
 *   - static subtrees are baked into the cloned markup and never visited again
 *   - identical markup shares one hoisted `<template>`
 *   - bindings whose expressions are provably constant are folded into markup
 *     and emit no effect at all
 *   - node references are resolved by `firstChild`/`nextSibling` chains
 *     computed at build time, reusing earlier references where possible
 *   - event handlers that close over nothing local are hoisted out of loops
 */

import {
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type RootNode,
  type SlotOutletNode,
  type TemplateChildNode,
  VOID_TAGS,
} from './ast.js';
import {
  ATTR_TO_PROP,
  BOOLEAN_ATTRIBUTES,
  DELEGATED_EVENTS,
  EVENT_GUARD_MODIFIERS,
  EVENT_OPTION_MODIFIERS,
  KEY_MODIFIERS,
  MUST_USE_ATTRIBUTE,
  SVG_TAGS,
  SYSTEM_MODIFIERS,
} from './dom-info.js';
import { CompilerError } from './parser.js';
import { parseExpression, parseForExpression } from './expression/parser.js';
import {
  collectDependencies,
  collectMessageKeys,
  createPrintContext,
  evaluateStatic,
  isStaticExpression,
  printExpression,
  printPattern,
  withScope,
  type PrintContext,
} from './expression/printer.js';
import { patternNames, type ExprNode, type PatternNode } from './expression/ast.js';

export interface CodegenOptions {
  runtime?: string;
  ctx?: string;
  filename?: string;
  dev?: boolean;
  /** Module specifier for the runtime import in `module` mode. */
  runtimeModule?: string;
  /**
   * Drive a `:for` row's bindings from one effect rather than one each.
   *
   * An effect costs roughly 1.6 kB against 31 bytes for a signal, and a row
   * typically has three, so this is most of what a row allocates. The trade is
   * coarser invalidation: any dependency of any binding in the row re-runs all
   * of them, each still comparing its own value before touching the DOM.
   *
   * Off by default while the two shapes are being measured against each other.
   */
  groupRowBindings?: boolean;
}

export interface CodegenResult {
  /** Body usable as `new Function('_rt', body)` -> returns the render fn. */
  body: string;
  /** Standalone ES module source exporting `render`. */
  code: string;
  /**
   * Module-level declarations (hoisted `<template>` cloners) that must appear
   * once, before the render function. Build-time embedding needs these
   * separately so they can be lifted to the top of the host module.
   */
  hoisted: string[];
  /** The expression that builds the DOM, given `_ctx` and `_rt` in scope. */
  renderExpression: string;
  /** Hoisted static markup strings, in emission order. */
  templates: string[];
  /** What the compiler removed or folded before runtime ever sees it. */
  stats: CompileStats;
  /**
   * Component tags this template can never render on first paint.
   *
   * A tag qualifies when every one of its occurrences sits inside a `:if`
   * chain or a `:portal` — so reaching it always depends on a condition, and
   * the initial render cannot include it unless that condition starts true.
   * The build uses this to decide what to split into its own chunk without
   * anyone having to declare it.
   *
   * `:for` deliberately does not qualify. A list is very often non-empty on
   * first render, and being wrong there costs a round trip on the critical
   * path — whereas being wrong about a dialog costs nothing.
   */
  deferrable: string[];
  /**
   * Literal message keys this template asks for, via `t('key')`.
   *
   * The build checks these against the catalogue, so a missing key is an error
   * with a file and a line rather than a fallback string found in production,
   * and puts each message in the chunk that uses it.
   */
  messageKeys: string[];
}

export interface CompileStats {
  templates: number;
  dedupedTemplates: number;
  effects: number;
  foldedBindings: number;
  delegatedEvents: number;
  hoistedHandlers: number;
  staticNodes: number;
  /** `:class` object keys compiled to independent per-class toggles. */
  classToggles: number;
}

interface Resolver {
  (path: number[]): string;
}

interface PendingEffect {
  (resolve: Resolver): string[];
}

/** One contiguous static DOM subtree with holes punched for dynamic parts. */
class Block {
  html: string[] = [];
  effects: PendingEffect[] = [];
  /** Per-depth child bookkeeping so paths account for merged text nodes. */
  private stack: { index: number; lastWasText: boolean }[] = [
    { index: 0, lastWasText: false },
  ];
  private path: number[] = [];
  rootCount = 0;
  isSvg = false;

  enter(childIndex: number): void {
    this.path.push(childIndex);
    this.stack.push({ index: 0, lastWasText: false });
  }

  exit(): void {
    this.path.pop();
    this.stack.pop();
  }

  currentPath(): number[] {
    return [...this.path];
  }

  /**
   * Reserve the next child slot. Adjacent text merges into a single DOM node,
   * so two consecutive text pieces share one index.
   */
  addChild(isText: boolean): number {
    const frame = this.stack[this.stack.length - 1]!;
    if (isText && frame.lastWasText) return frame.index - 1;
    frame.lastWasText = isText;
    const index = frame.index++;
    if (this.stack.length === 1) this.rootCount = frame.index;
    return index;
  }

  pathTo(childIndex: number): number[] {
    return [...this.path, childIndex];
  }
}

export function generate(root: RootNode, options: CodegenOptions = {}): CodegenResult {
  return new Generator(options).run(root);
}

class Generator {
  private readonly rt: string;
  /** See `CodegenOptions.groupRowBindings`. */
  private readonly groupRowBindings: boolean;
  /**
   * Set while generating a `:for` row, and cleared by the first block that
   * takes it. Only that outermost block groups; anything nested is reached
   * through an effect of its own and gains nothing.
   */
  private groupNextBlock = false;
  private readonly ctxName: string;
  private readonly dev: boolean;
  private readonly filename: string;
  private readonly runtimeModule: string;

  private templates: string[] = [];
  private templateIds = new Map<string, string>();
  private hoisted: string[] = [];
  private uid = 0;

  /** Depth of `:if` / `:portal` nesting, for the deferrable-tag analysis. */
  private conditionalDepth = 0;
  /** Every component tag seen, mapped to whether it was ever unconditional. */
  private componentTags = new Map<string, boolean>();
  /** Literal message keys this template asks for. */
  private messageKeys = new Set<string>();

  private stats: CompileStats = {
    templates: 0,
    dedupedTemplates: 0,
    effects: 0,
    foldedBindings: 0,
    delegatedEvents: 0,
    hoistedHandlers: 0,
    staticNodes: 0,
    classToggles: 0,
  };

  constructor(options: CodegenOptions) {
    this.rt = options.runtime ?? '_rt';
    this.ctxName = options.ctx ?? '_ctx';
    this.dev = options.dev ?? false;
    this.filename = options.filename ?? 'template';
    this.runtimeModule = options.runtimeModule ?? '@volt/core/runtime';
    this.groupRowBindings = options.groupRowBindings ?? false;
  }

  run(root: RootNode): CodegenResult {
    const ctx = createPrintContext(this.ctxName);
    const expression = this.genChildrenExpression(root.children, ctx);

    const lines: string[] = [];
    for (const h of this.hoisted) lines.push(h);
    lines.push('');
    lines.push(`return function render(${this.ctxName}) {`);
    lines.push(`  return ${expression};`);
    lines.push('};');

    const body = lines.join('\n');

    const moduleLines: string[] = [
      `import * as ${this.rt} from ${JSON.stringify(this.runtimeModule)};`,
      '',
      ...this.hoisted,
      '',
      `export function render(${this.ctxName}) {`,
      `  return ${expression};`,
      '}',
      '',
      'export default render;',
    ];

    return {
      body,
      code: moduleLines.join('\n'),
      hoisted: this.hoisted,
      renderExpression: expression,
      templates: this.templates,
      stats: this.stats,
      messageKeys: [...this.messageKeys].sort(),
      deferrable: [...this.componentTags]
        .filter(([, unconditional]) => !unconditional)
        .map(([tag]) => tag),
    };
  }

  // -------------------------------------------------------------------------
  // Naming and hoisting
  // -------------------------------------------------------------------------

  /**
   * Parse a template expression, noting any message keys it asks for.
   *
   * Wrapping the parser is what makes the collection exhaustive: there are ten
   * places an expression is parsed, and a key missed by one of them would be a
   * message the build believes nothing uses.
   */
  private parse(exp: string): ExprNode {
    const parsed = parseExpression(exp);
    collectMessageKeys(parsed, this.messageKeys);
    return parsed;
  }

  private nextId(prefix: string): string {
    return `_${prefix}${this.uid++}`;
  }

  /**
   * Wrap an expression as an arrow body.
   *
   * The parentheses are load-bearing: `() => { a: 1 }` is a function whose
   * body is a block containing a labelled statement, not one returning an
   * object. That mistake is silent for `:class="{ active: x }"` — it just
   * yields undefined — so every generated arrow gets them.
   */
  private thunk(expression: string, params = ''): string {
    return `(${params}) => (${expression})`;
  }

  /** Hoist static markup, reusing an existing template when identical. */
  private hoistTemplate(html: string, isSvg: boolean, rootCount: number): string {
    const key = `${isSvg ? 'svg' : 'html'}:${rootCount}:${html}`;
    const existing = this.templateIds.get(key);
    if (existing) {
      this.stats.dedupedTemplates++;
      return existing;
    }
    const id = this.nextId('tmpl');
    this.templateIds.set(key, id);
    this.templates.push(html);
    this.stats.templates++;
    const args = [JSON.stringify(html)];
    if (isSvg || rootCount > 1) args.push(String(rootCount), String(isSvg));
    this.hoisted.push(`const ${id} = ${this.rt}.template(${args.join(', ')});`);
    return id;
  }

  private error(message: string, node: { loc: { line: number; column: number } }): never {
    // Pass the filename through rather than appending it, so the message
    // names the file the template actually lives in.
    throw new CompilerError(message, node.loc, undefined, this.filename);
  }

  // -------------------------------------------------------------------------
  // Block generation
  // -------------------------------------------------------------------------

  /** Generate an expression producing the DOM for a list of sibling nodes. */
  private genChildrenExpression(nodes: TemplateChildNode[], ctx: PrintContext): string {
    // Taken here so the early single-child paths below, which recurse, cannot
    // pass it down to a nested block.
    const groupBindings = this.groupNextBlock;
    this.groupNextBlock = false;
    const meaningful = nodes.filter((n) => n.type !== 'comment');
    if (meaningful.length === 0) return 'null';

    // A lone dynamic node needs no template at all — emit its accessor
    // directly. This is not just an optimisation: a block whose only root is a
    // `<!>` marker would clone detached, leaving nothing to insert into.
    if (meaningful.length === 1) {
      const only = meaningful[0]!;
      if (only.type === 'interpolation') {
        return this.genInterpolationAccessor(only.exp, ctx, only);
      }
      if (only.type === 'slot-outlet') {
        return this.genSlotOutlet(only, ctx);
      }
      if (only.type === 'element') {
        // Checked before the rest: a portalled element renders elsewhere, so
        // whatever it is — component, template or plain element — this
        // position yields nothing.
        if (findDirective(only, 'portal') && !findDirective(only, 'if')) {
          return `(${this.genPortal(only, ctx).replace(/;$/, '')}, null)`;
        }
        if (findDirective(only, 'if')) return this.genConditionalChain([only], ctx);
        if (findDirective(only, 'for')) return this.genFor(only, ctx);
        if (only.isComponent) return this.genComponent(only, ctx);
        if (only.isTemplate) return this.genChildrenExpression(only.children, ctx);
      }
    }

    const block = new Block();
    this.buildChildren(meaningful, block, ctx);

    const html = block.html.join('');
    // Every dynamic child punches a `<!>` marker, so a block with children
    // always produces markup; empty input was handled above.
    if (!html) return 'null';

    const isSvg = block.isSvg;
    const rootCount = block.rootCount;
    const tmplId = this.hoistTemplate(html, isSvg, rootCount);

    const rootVar = this.nextId('el');
    const resolved = new Map<string, string>();
    // Seeding depends on what `template()` hands back. With a single root the
    // clone *is* that root element, which is path [0]. With several roots the
    // clone is the fragment containing them, which is path [].
    resolved.set(rootCount > 1 ? '' : '0', rootVar);

    const navigation: string[] = [];
    const resolve: Resolver = (path) => this.resolvePath(path, resolved, navigation);

    const effectLines: string[] = [];
    for (const effect of block.effects) {
      for (const line of effect(resolve)) effectLines.push(line);
    }

    const statements: string[] = [];
    statements.push(`const ${rootVar} = ${tmplId}();`);
    statements.push(...navigation);
    // One line cannot be shared with anything, and `group` would only add a
    // call for it to unwrap again.
    if (groupBindings && effectLines.length > 1) {
      statements.push(`${this.rt}.group(() => {\n${indent(effectLines.join('\n'), 2)}\n});`);
    } else {
      statements.push(...effectLines);
    }

    if (rootCount > 1) {
      // Capture top-level nodes before insertion moves them out of the fragment.
      const nodesVar = this.nextId('nodes');
      statements.push(`const ${nodesVar} = ${this.rt}.childNodes(${rootVar});`);
      statements.push(`return ${nodesVar};`);
    } else {
      statements.push(`return ${rootVar};`);
    }

    return `(() => {\n${indent(statements.join('\n'), 2)}\n})()`;
  }

  /**
   * Emit the minimal `firstChild` / `nextSibling` chain reaching `path`,
   * reusing any already-resolved ancestor or preceding sibling.
   */
  private resolvePath(
    path: number[],
    resolved: Map<string, string>,
    out: string[],
  ): string {
    const key = path.join(',');
    const cached = resolved.get(key);
    if (cached) return cached;

    const last = path[path.length - 1]!;
    const parentPath = path.slice(0, -1);

    let base: string;
    let steps: string;

    // Prefer stepping from the previous sibling when it already has a name.
    const siblingKey = [...parentPath, last - 1].join(',');
    const sibling = last > 0 ? resolved.get(siblingKey) : undefined;
    if (sibling) {
      base = sibling;
      steps = '.nextSibling';
    } else {
      const parent = this.resolvePath(parentPath, resolved, out);
      base = parent;
      steps = '.firstChild' + '.nextSibling'.repeat(last);
    }

    const name = this.nextId('el');
    out.push(`const ${name} = ${base}${steps};`);
    resolved.set(key, name);
    return name;
  }

  // -------------------------------------------------------------------------
  // Building markup + effects
  // -------------------------------------------------------------------------

  private buildChildren(nodes: TemplateChildNode[], block: Block, ctx: PrintContext): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;

      // `:if` / `:else-if` / `:else` chains are consumed as a single unit.
      if (node.type === 'element' && findDirective(node, 'if')) {
        const chain: ElementNode[] = [node];
        let j = i + 1;
        while (j < nodes.length) {
          const next = nodes[j];
          if (next?.type === 'comment') {
            j++;
            continue;
          }
          if (
            next?.type === 'element' &&
            (findDirective(next, 'else-if') || findDirective(next, 'else'))
          ) {
            chain.push(next);
            j++;
            if (findDirective(next, 'else')) break;
            continue;
          }
          break;
        }
        i = j - 1;
        this.emitDynamicChild(block, this.genConditionalChain(chain, ctx));
        continue;
      }

      if (node.type === 'element' && findDirective(node, 'else-if')) {
        this.error('`:else-if` must directly follow an element with `:if`', node);
      }
      if (node.type === 'element' && findDirective(node, 'else')) {
        this.error('`:else` must directly follow an element with `:if` or `:else-if`', node);
      }

      if (node.type === 'element' && findDirective(node, 'for')) {
        this.emitDynamicChild(block, this.genFor(node, ctx));
        continue;
      }

      // A portalled element renders somewhere else entirely, so it leaves no
      // marker behind — nothing is ever inserted at this position.
      if (node.type === 'element' && findDirective(node, 'portal')) {
        this.emitDetachedChild(block, this.genPortal(node, ctx));
        continue;
      }

      this.buildNode(node, block, ctx);
    }
  }

  /**
   * Emit a statement that produces DOM somewhere other than here.
   *
   * Unlike `emitDynamicChild` this punches no marker and reserves no child
   * slot, because nothing is ever inserted at this position — the surrounding
   * markup must come out exactly as if the node had not been written.
   */
  private emitDetachedChild(block: Block, statement: string): void {
    this.stats.effects++;
    block.effects.push(() => [statement]);
  }

  /** Punch a marker into the markup and insert a dynamic value at it. */
  private emitDynamicChild(block: Block, accessor: string): void {
    const index = block.addChild(false);
    const path = block.pathTo(index);
    const parentPath = block.currentPath();
    block.html.push('<!>');
    this.stats.effects++;
    block.effects.push((resolve) => {
      const marker = resolve(path);
      const parent = parentPath.length === 0 ? null : resolve(parentPath);
      return [
        `${this.rt}.insert(${parent ?? `${marker}.parentNode`}, ${accessor}, ${marker});`,
      ];
    });
  }

  private buildNode(node: TemplateChildNode, block: Block, ctx: PrintContext): void {
    switch (node.type) {
      case 'text': {
        if (!node.content) return;
        block.addChild(true);
        block.html.push(escapeHtmlText(node.content));
        this.stats.staticNodes++;
        return;
      }

      case 'comment': {
        block.addChild(false);
        block.html.push(`<!--${node.content}-->`);
        return;
      }

      case 'interpolation': {
        const accessor = this.genInterpolationAccessor(node.exp, ctx, node);
        const parsed = this.parse(node.exp);
        // A constant interpolation is just text — bake it into the markup.
        if (isStaticExpression(parsed)) {
          const value = evaluateStatic(parsed);
          block.addChild(true);
          block.html.push(escapeHtmlText(toDisplayString(value)));
          this.stats.foldedBindings++;
          return;
        }
        const index = block.addChild(false);
        const path = block.pathTo(index);
        const parentPath = block.currentPath();
        block.html.push('<!>');
        this.stats.effects++;
        block.effects.push((resolve) => {
          const marker = resolve(path);
          const parent = parentPath.length === 0 ? `${marker}.parentNode` : resolve(parentPath);
          return [`${this.rt}.insert(${parent}, ${accessor}, ${marker});`];
        });
        return;
      }

      case 'slot-outlet': {
        this.emitDynamicChild(block, this.genSlotOutlet(node, ctx));
        return;
      }

      case 'element': {
        if (node.isComponent) {
          this.emitDynamicChild(block, this.genComponent(node, ctx));
          return;
        }
        if (node.isTemplate) {
          // A grouping `<template>` contributes children but no element.
          this.buildChildren(node.children, block, ctx);
          return;
        }
        this.buildElement(node, block, ctx);
        return;
      }
    }
  }

  private buildElement(node: ElementNode, block: Block, ctx: PrintContext): void {
    const tag = node.tag;
    const isSvg = SVG_TAGS.has(tag);
    if (isSvg && tag === 'svg') block.isSvg = true;

    const index = block.addChild(false);
    const selfPath = block.pathTo(index);

    const staticAttrs = new Map<string, string | true>();
    for (const attr of node.attrs) {
      staticAttrs.set(attr.name, attr.value === null ? true : attr.value);
    }

    const dynamic: DirectiveNode[] = [];

    // Pass 1 — fold every provably-constant binding into the markup so it
    // costs nothing at runtime.
    for (const dir of node.directives) {
      if (dir.kind === 'key' || dir.kind === 'slot') continue;

      if ((dir.kind === 'prop' || dir.kind === 'attr' || dir.kind === 'class') && dir.exp) {
        const parsed = this.parse(dir.exp);
        if (isStaticExpression(parsed)) {
          const value = evaluateStatic(parsed);
          const name = dir.kind === 'class' ? 'class' : dir.name;

          if (dir.kind === 'class') {
            const cls = normalizeClassValue(value);
            if (cls) mergeStaticClass(staticAttrs, cls);
            this.stats.foldedBindings++;
            continue;
          }
          if (BOOLEAN_ATTRIBUTES.has(name)) {
            if (value) staticAttrs.set(name, '');
            else staticAttrs.delete(name);
            this.stats.foldedBindings++;
            continue;
          }
          if (value === false || value === null || value === undefined) {
            staticAttrs.delete(name);
            this.stats.foldedBindings++;
            continue;
          }
          staticAttrs.set(name, String(value));
          this.stats.foldedBindings++;
          continue;
        }
      }

      if (dir.kind === 'style' && dir.exp) {
        const parsed = this.parse(dir.exp);
        if (isStaticExpression(parsed)) {
          const style = normalizeStyleValue(evaluateStatic(parsed));
          if (style) {
            const existing = staticAttrs.get('style');
            staticAttrs.set(
              'style',
              typeof existing === 'string' ? `${existing};${style}` : style,
            );
          }
          this.stats.foldedBindings++;
          continue;
        }
      }

      dynamic.push(dir);
    }

    // Emit the open tag with all folded attributes baked in.
    let open = `<${tag}`;
    for (const [name, value] of staticAttrs) {
      open += value === true ? ` ${name}` : ` ${name}="${escapeHtmlAttr(value)}"`;
    }
    open += '>';
    block.html.push(open);

    if (dynamic.length) {
      for (const dir of dynamic) {
        this.emitDirective(dir, node, selfPath, block, ctx);
      }
    } else {
      this.stats.staticNodes++;
    }

    const isVoid = VOID_TAGS.has(tag.toLowerCase());
    if (!isVoid) {
      const hasTextDirective = node.directives.some(
        (d) => d.kind === 'text' || d.kind === 'html',
      );
      const handled =
        !hasTextDirective &&
        (this.tryTextOnlyChildren(node, block, selfPath, ctx) ||
          this.trySingleDynamicChild(node, block, selfPath, ctx));

      if (!handled && !hasTextDirective) {
        block.enter(index);
        this.buildChildren(node.children, block, ctx);
        block.exit();
      }
      block.html.push(`</${tag}>`);
    }
  }

  /**
   * An element whose only child is dynamic needs no marker.
   *
   * The binding owns the element's entire content, so it can insert without an
   * anchor — which keeps a stray `<!---->` out of the DOM for the very common
   * `<ul>` wrapping a single `:for`, or a `<div>` wrapping a single `:if`.
   */
  private trySingleDynamicChild(
    node: ElementNode,
    block: Block,
    selfPath: number[],
    ctx: PrintContext,
  ): boolean {
    const children = node.children.filter(
      (c) => c.type !== 'comment' && !(c.type === 'text' && !c.content.trim()),
    );
    if (children.length !== 1) return false;

    const only = children[0]!;
    // A portalled child contributes nothing at this position, so there is
    // nothing to insert here and this path does not apply. Without this it
    // would take the component branch below and the portal would be dropped.
    if (only.type === 'element' && findDirective(only, 'portal')) return false;

    const isDynamic =
      only.type === 'slot-outlet' ||
      (only.type === 'element' &&
        (only.isComponent ||
          only.isTemplate ||
          findDirective(only, 'if') !== undefined ||
          findDirective(only, 'for') !== undefined));
    if (!isDynamic) return false;

    const accessor = this.genChildrenExpression([only], ctx);
    this.stats.effects++;
    block.effects.push((resolve) => [
      `${this.rt}.insert(${resolve(selfPath)}, ${accessor});`,
    ]);
    return true;
  }

  /**
   * When an element's children are only text and interpolations, compile them
   * to a single text binding instead of one marker per hole.
   *
   * `<p>Hi, { a }! You have { b }.</p>` becomes one effect writing one
   * text node — no comment markers in the output, and no per-hole insert.
   * Returns false when the children contain anything structural.
   */
  private tryTextOnlyChildren(
    node: ElementNode,
    block: Block,
    selfPath: number[],
    ctx: PrintContext,
  ): boolean {
    const children = node.children.filter((c) => c.type !== 'comment');
    if (children.length === 0) return false;

    const allText = children.every((c) => c.type === 'text' || c.type === 'interpolation');
    if (!allText) return false;

    const dynamic = children.filter((c) => c.type === 'interpolation');
    // All-static children belong in the markup, which the normal path does.
    if (dynamic.length === 0) return false;

    const parts: string[] = [];
    let sawDynamic = false;

    for (const child of children) {
      if (child.type === 'text') {
        if (child.content) parts.push(JSON.stringify(child.content));
        continue;
      }
      const parsed = this.parse(child.exp);
      if (isStaticExpression(parsed)) {
        this.stats.foldedBindings++;
        parts.push(JSON.stringify(toDisplayString(evaluateStatic(parsed))));
        continue;
      }
      sawDynamic = true;
      parts.push(`${this.rt}.toDisplayString(${printExpression(parsed, ctx, 1)})`);
    }

    if (!sawDynamic) {
      // Every hole folded to a constant — emit it as static markup.
      const literal = parts
        .map((p) => JSON.parse(p) as string)
        .join('');
      block.html.push(escapeHtmlText(literal));
      return true;
    }

    // A lone dynamic part needs no concatenation.
    const expression = parts.length === 1 ? parts[0]! : parts.join(' + ');

    this.stats.effects++;
    block.effects.push((resolve) => [
      `${this.rt}.bindText(${resolve(selfPath)}, ${this.thunk(expression)});`,
    ]);
    return true;
  }

  // -------------------------------------------------------------------------
  // Directives
  // -------------------------------------------------------------------------

  private emitDirective(
    dir: DirectiveNode,
    node: ElementNode,
    path: number[],
    block: Block,
    ctx: PrintContext,
  ): void {
    const push = (fn: (el: string) => string[]): void => {
      this.stats.effects++;
      block.effects.push((resolve) => fn(resolve(path)));
    };

    switch (dir.kind) {
      case 'event': {
        const { handler, options } = this.genEventHandler(dir, ctx);
        // Listener options (capture/once/passive) need a real listener on the
        // element; everything else can share one document-level listener.
        const canDelegate = options === null && DELEGATED_EVENTS.has(dir.name);
        if (canDelegate) {
          this.stats.delegatedEvents++;
          push((el) => [
            `${this.rt}.delegate(${el}, ${JSON.stringify(dir.name)}, ${handler});`,
          ]);
        } else {
          push((el) => [
            `${this.rt}.on(${el}, ${JSON.stringify(dir.name)}, ${handler}${options ? `, ${options}` : ''});`,
          ]);
        }
        return;
      }

      case 'class': {
        const toggles = this.genClassToggles(dir.exp!, ctx);
        if (toggles) {
          for (const [name, accessor] of toggles) {
            push((el) => [
              `${this.rt}.bindClassToggle(${el}, ${JSON.stringify(name)}, ${accessor});`,
            ]);
          }
          return;
        }
        const accessor = this.genAccessor(dir.exp!, ctx);
        push((el) => [`${this.rt}.bindClass(${el}, ${accessor});`]);
        return;
      }

      case 'style': {
        const accessor = this.genAccessor(dir.exp!, ctx);
        push((el) => [`${this.rt}.bindStyle(${el}, ${accessor});`]);
        return;
      }

      case 'attr': {
        const accessor = this.genAccessor(dir.exp!, ctx);
        push((el) => [
          `${this.rt}.bindAttr(${el}, ${JSON.stringify(dir.name)}, ${accessor});`,
        ]);
        return;
      }

      case 'prop': {
        const accessor = this.genAccessor(dir.exp!, ctx);
        const name = dir.name;
        // Decide prop-vs-attribute at build time wherever the DOM allows it.
        if (MUST_USE_ATTRIBUTE.has(name)) {
          push((el) => [
            `${this.rt}.bindAttr(${el}, ${JSON.stringify(name)}, ${accessor});`,
          ]);
        } else if (BOOLEAN_ATTRIBUTES.has(name)) {
          const prop = ATTR_TO_PROP[name] ?? name;
          push((el) => [
            `${this.rt}.bindProp(${el}, ${JSON.stringify(prop)}, ${accessor});`,
          ]);
        } else {
          push((el) => [
            `${this.rt}.bindDynamic(${el}, ${JSON.stringify(name)}, ${accessor});`,
          ]);
        }
        return;
      }

      case 'text': {
        const accessor = this.genAccessor(dir.exp!, ctx);
        push((el) => [`${this.rt}.bindText(${el}, ${accessor});`]);
        return;
      }

      case 'html': {
        const accessor = this.genAccessor(dir.exp!, ctx);
        push((el) => [`${this.rt}.bindHtml(${el}, ${accessor});`]);
        return;
      }

      case 'ref': {
        const exp = dir.exp!;
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exp)) {
          this.error('`:ref` takes a plain property name, e.g. `:ref="inputEl"`', dir);
        }
        push((el) => [
          `${this.rt}.setRef(${el}, ${this.ctxName}, ${JSON.stringify(exp)});`,
        ]);
        return;
      }

      case 'model': {
        const kind = modelKind(node);
        const target = this.genAccessor(dir.exp!, ctx);
        const setter = this.genModelSetter(dir.exp!, ctx, dir);
        const modifiers = JSON.stringify({
          number: dir.modifiers.includes('number'),
          trim: dir.modifiers.includes('trim'),
          lazy: dir.modifiers.includes('lazy'),
        });
        push((el) => [
          `${this.rt}.model(${el}, ${JSON.stringify(kind)}, ${target}, ${setter}, ${modifiers});`,
        ]);
        return;
      }

      case 'spread': {
        const accessor = this.genAccessor(dir.exp!, ctx);
        push((el) => [`${this.rt}.spread(${el}, ${accessor});`]);
        return;
      }

      default:
        return;
    }
  }

  private genEventHandler(
    dir: DirectiveNode,
    ctx: PrintContext,
  ): { handler: string; options: string | null } {
    const exp = dir.exp;
    if (!exp) this.error(`\`${dir.rawName}\` requires a handler expression`, dir);

    const parsed = this.parse(exp);
    // A bare reference or arrow is already a function; anything else is an
    // inline statement and gets wrapped so `$event` is available.
    const isFunctionValue =
      parsed.type === 'Identifier' || parsed.type === 'Member' || parsed.type === 'Arrow';

    let handler = isFunctionValue
      ? printExpression(parsed, ctx)
      : this.thunk(printExpression(parsed, ctx, 1), '$event');

    const guards = dir.modifiers.filter((m) => EVENT_GUARD_MODIFIERS.has(m));
    const systems = dir.modifiers.filter((m) => SYSTEM_MODIFIERS.has(m));
    const keys = dir.modifiers
      .filter((m) => KEY_MODIFIERS[m] !== undefined)
      .map((m) => KEY_MODIFIERS[m]!);
    const optionMods = dir.modifiers.filter((m) => EVENT_OPTION_MODIFIERS.has(m));

    const unknown = dir.modifiers.filter(
      (m) =>
        !EVENT_GUARD_MODIFIERS.has(m) &&
        !SYSTEM_MODIFIERS.has(m) &&
        KEY_MODIFIERS[m] === undefined &&
        !EVENT_OPTION_MODIFIERS.has(m),
    );
    if (unknown.length) {
      this.error(`Unknown event modifier \`.${unknown[0]}\` on \`${dir.rawName}\``, dir);
    }

    if (guards.length || systems.length || keys.length) {
      const config = JSON.stringify({
        stop: guards.includes('stop'),
        prevent: guards.includes('prevent'),
        self: guards.includes('self'),
        system: systems,
        keys,
      });
      handler = `${this.rt}.guard(${handler}, ${config})`;
    }

    const options = optionMods.length
      ? JSON.stringify({
          capture: optionMods.includes('capture'),
          once: optionMods.includes('once'),
          passive: optionMods.includes('passive'),
        })
      : null;

    return { handler, options };
  }

  private genModelSetter(exp: string, ctx: PrintContext, dir: DirectiveNode): string {
    const parsed = this.parse(exp);
    if (parsed.type !== 'Identifier' && parsed.type !== 'Member') {
      this.error('`:model` needs a signal or assignable property, e.g. `:model="name"`', dir);
    }
    const target = printExpression(parsed, ctx);
    return `(_v) => ${this.rt}.writeModel(${target}, _v, () => { ${target} = _v; })`;
  }

  // -------------------------------------------------------------------------
  // Structural constructs
  // -------------------------------------------------------------------------

  private genInterpolationAccessor(
    exp: string,
    ctx: PrintContext,
    node: { loc: { line: number; column: number } },
  ): string {
    let parsed: ExprNode;
    try {
      parsed = this.parse(exp);
    } catch (err) {
      this.error((err as Error).message, node);
    }
    if (isStaticExpression(parsed)) {
      this.stats.foldedBindings++;
      return JSON.stringify(toDisplayString(evaluateStatic(parsed)));
    }
    return this.thunk(printExpression(parsed, ctx, 1));
  }

  /**
   * Split `:class="{ a: x, b: y }"` into one toggle per class.
   *
   * The general binding has to allocate the object, normalise it to a list,
   * and ask the element what it already has. When the keys are written
   * literally — nearly always — each class is really an independent boolean,
   * and compiling it that way means an update compares a boolean and usually
   * touches nothing.
   *
   * Returns null for any shape where the set of class names is not known
   * here: a string, an array, a spread, or a computed key. Those keep the
   * general binding, which stays correct for everything.
   */
  private genClassToggles(exp: string, ctx: PrintContext): [string, string][] | null {
    let parsed;
    try {
      parsed = this.parse(exp);
    } catch {
      return null;
    }
    if (parsed.type !== 'Object' || parsed.properties.length === 0) return null;

    const toggles: [string, string][] = [];
    for (const prop of parsed.properties) {
      if (prop.type !== 'Property' || prop.computed) return null;

      const key = prop.key;
      let name: string;
      if (key.type === 'Identifier') name = key.name;
      else if (key.type === 'Literal' && typeof key.value === 'string') name = key.value;
      else return null;

      // A name with whitespace would be several classes, which `classList`
      // cannot toggle as one token.
      if (name === '' || /\s/.test(name)) return null;

      toggles.push([name, this.thunk(printExpression(prop.value, ctx, 1))]);
    }

    // Two properties writing the same class would race, and which one wins
    // would depend on effect ordering rather than on the object's semantics.
    const names = new Set(toggles.map(([name]) => name));
    if (names.size !== toggles.length) return null;

    this.stats.classToggles += toggles.length;
    return toggles;
  }

  private genAccessor(exp: string, ctx: PrintContext): string {
    const parsed = this.parse(exp);
    if (isStaticExpression(parsed)) {
      return JSON.stringify(evaluateStatic(parsed));
    }
    return this.thunk(printExpression(parsed, ctx, 1));
  }

  /**
   * The whole `:if` / `:else-if` / `:else` chain becomes one `branch` call.
   * Conditions are tested in order and short-circuit, and only the winning
   * branch's body is ever built — a nested-ternary encoding would construct
   * every arm eagerly.
   */
  /**
   * `:portal` — render this element into a different container.
   *
   * With no virtual DOM, a portal is simply a node put somewhere else, so
   * there is nothing to reconcile across trees. Context and disposal both
   * follow the reactive scope rather than the DOM, so a portalled dialog still
   * sees the providers it was declared under and is still torn down with the
   * component that declared it.
   *
   * The target is read once. Re-homing live content on a changing target is
   * not something a dialog or tooltip needs, and pretending to support it
   * would cost a marker and a move path on every portal.
   */
  private genPortal(node: ElementNode, ctx: PrintContext): string {
    const dir = findDirective(node, 'portal')!;
    const stripped = stripDirectives(node, ['portal']);

    // Default to the document body, which is what an overlay almost always
    // wants and saves every call site writing it out.
    const target = dir.exp ? this.genAccessor(dir.exp, ctx) : 'null';
    const body = this.inConditional(() =>
      stripped.isTemplate
        ? this.genChildrenExpression(stripped.children, ctx)
        : this.genChildrenExpression([stripped], ctx),
    );
    return `${this.rt}.portal(${target}, ${this.thunk(body)});`;
  }

  private genConditionalChain(chain: ElementNode[], ctx: PrintContext): string {
    const entries = chain.map((node) => {
      const body = this.thunk(this.genBranchBody(node, ctx));
      if (findDirective(node, 'else')) return `[null, ${body}]`;
      const dir = findDirective(node, 'if') ?? findDirective(node, 'else-if')!;
      const condition = this.thunk(printExpression(this.parse(dir.exp!), ctx, 1));
      return `[${condition}, ${body}]`;
    });
    return `${this.rt}.branch([${entries.join(', ')}])`;
  }

  /** Render one branch of a conditional without re-triggering its own `:if`. */
  private genBranchBody(node: ElementNode, ctx: PrintContext): string {
    return this.inConditional(() => this.genBranchBodyInner(node, ctx));
  }

  private genBranchBodyInner(node: ElementNode, ctx: PrintContext): string {
    const stripped = stripDirectives(node, ['if', 'else-if', 'else']);
    if (findDirective(stripped, 'for')) {
      return this.genFor(stripped, ctx);
    }
    // `<div :if="open" :portal>` — the condition decides whether the portal
    // exists at all, and the portal decides where its content lands. The
    // branch itself contributes nothing to the tree it was declared in.
    if (findDirective(stripped, 'portal')) {
      return `(${this.genPortal(stripped, ctx).replace(/;$/, '')}, null)`;
    }
    if (stripped.isTemplate) {
      return this.genChildrenExpression(stripped.children, ctx);
    }
    return this.genChildrenExpression([stripped], ctx);
  }

  /**
   * `:for` rows receive their item and index as accessors, and the printer
   * appends the call. That is what lets a keyed row survive a move or a
   * re-supplied item object without being torn down and rebuilt — the row's
   * own bindings re-run, the DOM does not.
   */
  private genFor(node: ElementNode, ctx: PrintContext): string {
    const dir = findDirective(node, 'for')!;

    let parsed;
    try {
      parsed = parseForExpression(dir.exp!);
    } catch (err) {
      // The expression parser cannot know what it was parsing; say so here.
      this.error(
        `\`:for="${dir.exp}"\` is not a loop.\n` +
          '  It reads as `:for="item in items()"`, optionally with an index:\n' +
          '  `:for="(item, i) in items()"`.\n' +
          `  ${(err as Error).message}`,
        dir,
      );
    }
    const keyDir = findDirective(node, 'key');

    // `:key` is mandatory. Neither possible default is safe — keying by
    // position strands DOM state on the wrong row after a reorder, and keying
    // by object identity rebuilds the whole list when data is refetched — so
    // the choice is the author's to make, every time.
    if (!keyDir?.exp) {
      this.error(
        '`:for` requires `:key`.\n' +
          '  Use `:key="item.id"` for a stable identity that survives the item\n' +
          '  object being replaced, or `:key="$index"` if this list is never\n' +
          '  reordered and positional reuse is what you want.',
        dir,
      );
    }

    const listAccessor = this.thunk(printExpression(parsed.source, ctx, 1));
    const stripped = stripDirectives(node, ['for', 'key']);
    const indexParam = parsed.index ?? this.nextId('idx');

    const genBody = (): string => {
      this.groupNextBlock = this.groupRowBindings;
      const body = stripped.isTemplate
        ? this.genChildrenExpression(stripped.children, ctx)
        : this.genChildrenExpression([stripped], ctx);
      this.groupNextBlock = false;
      return body;
    };

    let rowFn: string;

    if (parsed.item.type === 'IdentifierPattern') {
      const itemName = parsed.item.name;
      const body = withScope(ctx, [itemName, indexParam], genBody, true);
      rowFn = this.thunk(body, `${itemName}, ${indexParam}`);
    } else {
      // Destructuring: rebuild each bound name as its own accessor so the
      // fields stay reactive rather than being snapshotted at row creation.
      const itemVar = this.nextId('item');
      const lines: string[] = [];
      const names: string[] = [];
      this.genPatternAccessors(parsed.item, `${itemVar}()`, lines, names);
      const body = withScope(ctx, [...names, indexParam], genBody, true);
      lines.push(`return ${body};`);
      rowFn = `(${itemVar}, ${indexParam}) => {\n${indent(lines.join('\n'), 2)}\n}`;
    }

    // The key function sees raw values, so its scope is plain — no auto-call.
    const keyNames = patternNames(parsed.item);
    if (parsed.index) keyNames.push(parsed.index);

    const keyFn = withScope(ctx, keyNames, () => {
      const itemParam = printPattern(parsed.item, ctx);
      const expression = printExpression(this.parse(keyDir.exp!), ctx, 1);

      // `$index` is always the second parameter, so `:key="$index"` works
      // whether or not the loop declared an index name of its own.
      if (parsed.index) {
        return `(${itemParam}, $index) => { const ${parsed.index} = $index; return (${expression}); }`;
      }
      return this.thunk(expression, `${itemParam}, $index`);
    });

    return `${this.rt}.each(${listAccessor}, ${rowFn}, ${keyFn})`;
  }

  /** Emit `const name = () => <path>` accessors for a destructuring pattern. */
  private genPatternAccessors(
    pattern: PatternNode,
    source: string,
    out: string[],
    names: string[],
  ): void {
    switch (pattern.type) {
      case 'IdentifierPattern': {
        out.push(`const ${pattern.name} = ${this.thunk(source)};`);
        names.push(pattern.name);
        return;
      }

      case 'ObjectPattern': {
        for (const prop of pattern.properties) {
          const access = isSafeIdentifier(prop.key)
            ? `(${source})?.${prop.key}`
            : `(${source})?.[${JSON.stringify(prop.key)}]`;
          this.genPatternAccessors(prop.value, access, out, names);
        }
        if (pattern.rest) {
          const keys = JSON.stringify(pattern.properties.map((p) => p.key));
          out.push(`const ${pattern.rest} = () => ${this.rt}.omit(${source}, ${keys});`);
          names.push(pattern.rest);
        }
        return;
      }

      case 'ArrayPattern': {
        for (let i = 0; i < pattern.elements.length; i++) {
          const element = pattern.elements[i];
          if (!element) continue;
          if (element.type === 'RestPattern') {
            const target = element.argument;
            if (target.type !== 'IdentifierPattern') {
              throw new CompilerError('`...rest` in `:for` must bind a plain name', {
                line: 0,
                column: 0,
              });
            }
            out.push(`const ${target.name} = () => (${source})?.slice(${i}) ?? [];`);
            names.push(target.name);
            continue;
          }
          this.genPatternAccessors(element, `(${source})?.[${i}]`, out, names);
        }
        return;
      }

      case 'AssignmentPattern': {
        const ctxForDefault = createPrintContext(this.ctxName);
        const fallback = printExpression(pattern.right, ctxForDefault, 1);
        this.genPatternAccessors(
          pattern.left,
          `${this.rt}.withDefault(${source}, () => ${fallback})`,
          out,
          names,
        );
        return;
      }

      case 'RestPattern': {
        this.genPatternAccessors(pattern.argument, source, out, names);
        return;
      }
    }
  }

  private genSlotOutlet(node: SlotOutletNode, ctx: PrintContext): string {
    const fallback = node.children.length
      ? this.thunk(this.genChildrenExpression(node.children, ctx))
      : 'null';

    const props = this.genSlotProps(node.directives, node.attrs, ctx);
    return `${this.rt}.slot(${this.ctxName}, ${JSON.stringify(node.name)}, ${props}, ${fallback})`;
  }

  private genSlotProps(
    directives: DirectiveNode[],
    attrs: AttributeNode[],
    ctx: PrintContext,
  ): string {
    const entries: string[] = [];
    for (const attr of attrs) {
      entries.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value ?? true)}`);
    }
    for (const dir of directives) {
      if (dir.kind !== 'prop' || !dir.exp) continue;
      const parsed = this.parse(dir.exp);
      // Getters keep slot props lazy and reactive without wrapping functions.
      entries.push(
        `get ${JSON.stringify(dir.name)}() { return ${printExpression(parsed, ctx, 1)}; }`,
      );
    }
    return entries.length ? `{ ${entries.join(', ')} }` : 'null';
  }

  // -------------------------------------------------------------------------
  // Components
  // -------------------------------------------------------------------------

  /** Note a component tag, and whether this occurrence is reachable directly. */
  private noteComponentTag(tag: string): void {
    const unconditional = this.conditionalDepth === 0;
    // Once seen unconditionally it stays that way: one direct occurrence is
    // enough to put the component on the first-paint path.
    this.componentTags.set(tag, (this.componentTags.get(tag) ?? false) || unconditional);
  }

  /** Generate `body` as sitting behind a condition, for the analysis. */
  private inConditional<T>(body: () => T): T {
    this.conditionalDepth++;
    try {
      return body();
    } finally {
      this.conditionalDepth--;
    }
  }

  private genComponent(node: ElementNode, ctx: PrintContext): string {
    this.noteComponentTag(node.tag);
    const props: string[] = [];
    const events: string[] = [];

    for (const attr of node.attrs) {
      props.push(`${JSON.stringify(attr.name)}: ${JSON.stringify(attr.value ?? true)}`);
    }

    for (const dir of node.directives) {
      switch (dir.kind) {
        case 'event': {
          const { handler } = this.genEventHandler(dir, ctx);
          events.push(`${JSON.stringify(dir.name)}: ${handler}`);
          break;
        }
        case 'prop':
        case 'class':
        case 'style':
        case 'attr': {
          if (!dir.exp) break;
          const parsed = this.parse(dir.exp);
          const name = dir.kind === 'class' ? 'class' : dir.kind === 'style' ? 'style' : dir.name;

          // A callback prop given a bare method reference would arrive
          // unbound, and `this` inside it would be the child. Wrap it so the
          // method is invoked on the component that declared it. Restricted
          // to the `onX` naming convention, since wrapping an ordinary value
          // in an arrow would break it.
          const isCallbackProp = /^on[A-Z]/.test(name);
          const isBareReference = parsed.type === 'Identifier' || parsed.type === 'Member';
          if (isCallbackProp && isBareReference) {
            const target = printExpression(parsed, ctx);
            props.push(`${JSON.stringify(name)}: (...a) => ${target}(...a)`);
            break;
          }

          if (isStaticExpression(parsed)) {
            this.stats.foldedBindings++;
            props.push(`${JSON.stringify(name)}: ${JSON.stringify(evaluateStatic(parsed))}`);
          } else {
            // Lazy getter: the child only pays for props it actually reads.
            props.push(
              `get ${JSON.stringify(name)}() { return ${printExpression(parsed, ctx, 1)}; }`,
            );
          }
          break;
        }
        case 'model': {
          const target = this.genAccessor(dir.exp!, ctx);
          const setter = this.genModelSetter(dir.exp!, ctx, dir);
          // A value in and a callback out — both ordinary inputs.
          props.push(`get "modelValue"() { return (${target})(); }`);
          props.push(`"onModelValue": ${setter}`);
          break;
        }
        case 'spread': {
          props.push(`...${printExpression(this.parse(dir.exp!), ctx, 1)}`);
          break;
        }
        case 'ref': {
          props.push(
            `"__ref": (_c) => ${this.rt}.setRef(_c, ${this.ctxName}, ${JSON.stringify(dir.exp)})`,
          );
          break;
        }
        default:
          break;
      }
    }

    const slots = this.genSlots(node, ctx);

    const propsExpr = props.length ? `{ ${props.join(', ')} }` : 'null';
    const eventsExpr = events.length ? `{ ${events.join(', ')} }` : 'null';

    return `${this.rt}.createComponent(${this.ctxName}, ${JSON.stringify(node.tag)}, ${propsExpr}, ${eventsExpr}, ${slots})`;
  }

  private genSlots(node: ElementNode, ctx: PrintContext): string {
    const named = new Map<string, TemplateChildNode[]>();
    const defaultChildren: TemplateChildNode[] = [];

    for (const child of node.children) {
      if (child.type === 'element') {
        const slotDir = findDirective(child, 'slot');
        if (slotDir?.exp) {
          const name = stripQuotes(slotDir.exp);
          const list = named.get(name) ?? [];
          const stripped = stripDirectives(child, ['slot']);
          list.push(stripped.isTemplate ? ({ ...stripped } as ElementNode) : stripped);
          named.set(name, list);
          continue;
        }
      }
      defaultChildren.push(child);
    }

    const entries: string[] = [];
    const meaningfulDefault = defaultChildren.filter(
      (c) => c.type !== 'comment' && !(c.type === 'text' && !c.content.trim()),
    );
    if (meaningfulDefault.length) {
      entries.push(`default: () => ${this.genChildrenExpression(defaultChildren, ctx)}`);
    }
    for (const [name, children] of named) {
      const nodes = children.flatMap((c) =>
        c.type === 'element' && c.isTemplate ? c.children : [c],
      );
      entries.push(
        `${JSON.stringify(name)}: () => ${this.genChildrenExpression(nodes, ctx)}`,
      );
    }

    return entries.length ? `{ ${entries.join(', ')} }` : 'null';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDirective(node: ElementNode, kind: string): DirectiveNode | undefined {
  return node.directives.find((d) => d.kind === kind);
}

function hasStructural(node: ElementNode): boolean {
  return node.directives.some(
    (d) => d.kind === 'if' || d.kind === 'else-if' || d.kind === 'else' || d.kind === 'for',
  );
}

function stripDirectives(node: ElementNode, kinds: string[]): ElementNode {
  return { ...node, directives: node.directives.filter((d) => !kinds.includes(d.kind)) };
}

function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function modelKind(node: ElementNode): string {
  const tag = node.tag.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'text';
  const type = node.attrs.find((a) => a.name === 'type')?.value?.toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'number' || type === 'range') return 'number';
  return 'text';
}

function normalizeClassValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(normalizeClassValue).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k)
      .join(' ');
  }
  return '';
}

function normalizeStyleValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== false)
      .map(([k, v]) => `${hyphenate(k)}:${String(v)}`)
      .join(';');
  }
  return '';
}

function mergeStaticClass(attrs: Map<string, string | true>, cls: string): void {
  const existing = attrs.get('class');
  attrs.set('class', typeof existing === 'string' && existing ? `${existing} ${cls}` : cls);
}

function hyphenate(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Escape text for embedding in the cloned markup.
 *
 * A bare `&` must become `&amp;`, but an `&` that already begins an entity
 * must not — escaping it would double-encode, so `&amp;` in a template would
 * render as the literal text "&amp;" instead of "&".
 */
function escapeHtmlText(text: string): string {
  return text
    .replaceAll(/&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#[xX][0-9a-fA-F]+;)/g, '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

export { collectDependencies };

/**
 * @voltjs/compiler — Volt template source -> DOM-building JavaScript.
 *
 * The compiler is a pure `string -> string` transform with no DOM or Node
 * dependencies, which is what lets the exact same code path run in two places:
 *
 *   - at build time, through `@voltjs/vite-plugin`, emitting an ES module
 *   - at runtime, through `new Function`, when no build step is present
 *
 * Both modes produce identical output, so behaviour never diverges between
 * development and production.
 */

import { parse, CompilerError, type ParserOptions } from './parser.js';
import { generate, type CodegenOptions, type CodegenResult, type CompileStats } from './codegen.js';
import type { RootNode } from './ast.js';

export interface CompileOptions extends ParserOptions, CodegenOptions {}

export interface CompileResult extends CodegenResult {
  ast: RootNode;
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const ast = parse(source, options);
  const result = generate(ast, options);
  return { ...result, ast };
}

export { parse, generate, CompilerError };

export type {
  ParserOptions,
  CodegenOptions,
  CodegenResult,
  CompileStats,
  RootNode,
};

export type {
  AttributeNode,
  CommentNode,
  DirectiveKind,
  DirectiveNode,
  ElementNode,
  InterpolationNode,
  SlotOutletNode,
  SourceLocation,
  TemplateChildNode,
  TextNode,
} from './ast.js';

export {
  KNOWN_EVENTS,
  HTML_TAGS,
  SVG_TAGS,
  BOOLEAN_ATTRIBUTES,
  MUST_USE_ATTRIBUTE,
  isComponentTag,
} from './dom-info.js';

export { parseExpression, parseForExpression } from './expression/parser.js';
export {
  isStaticExpression,
  evaluateStatic,
  printExpression,
  createPrintContext,
  collectDependencies,
  TEMPLATE_GLOBALS,
} from './expression/printer.js';
export type { ExprNode, PatternNode } from './expression/ast.js';

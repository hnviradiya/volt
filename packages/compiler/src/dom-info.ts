/**
 * Static DOM knowledge the compiler uses to resolve `:name` directives and to
 * decide what can be baked into markup at build time.
 */

/**
 * Standard DOM event names. A bare `:name` whose name appears here compiles to
 * an event listener; anything else becomes a property/attribute binding. Use
 * `:on-name` to force an event (custom events, component outputs) and
 * `:prop-name` / `:attr-name` to force the other direction.
 */
export const KNOWN_EVENTS = new Set([
  // Mouse / pointer
  'click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave',
  'mouseover', 'mouseout', 'contextmenu', 'wheel',
  'pointerdown', 'pointerup', 'pointermove', 'pointerenter', 'pointerleave',
  'pointerover', 'pointerout', 'pointercancel', 'gotpointercapture', 'lostpointercapture',
  // Touch
  'touchstart', 'touchend', 'touchmove', 'touchcancel',
  // Keyboard
  'keydown', 'keyup', 'keypress',
  // Form
  'input', 'change', 'submit', 'reset', 'invalid', 'search',
  'focus', 'blur', 'focusin', 'focusout', 'select',
  // Clipboard / drag
  'copy', 'cut', 'paste',
  'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
  // Media
  'play', 'pause', 'ended', 'volumechange', 'timeupdate', 'durationchange',
  'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough', 'seeking', 'seeked',
  'stalled', 'suspend', 'waiting', 'ratechange', 'emptied',
  // Loading / lifecycle
  'load', 'error', 'abort', 'beforeunload', 'unload',
  'scroll', 'scrollend', 'resize', 'toggle', 'close', 'cancel',
  // Animation / transition
  'animationstart', 'animationend', 'animationiteration', 'animationcancel',
  'transitionstart', 'transitionend', 'transitionrun', 'transitioncancel',
  // Misc
  'beforeinput', 'compositionstart', 'compositionupdate', 'compositionend',
  'securitypolicyviolation', 'slotchange', 'formdata',
]);

/** Every standard HTML element — used to tell DOM tags from components. */
export const HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo',
  'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col',
  'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl',
  'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img',
  'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu',
  'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p',
  'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th',
  'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
]);

export const SVG_TAGS = new Set([
  'svg', 'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs',
  'desc', 'ellipse', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
  'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur',
  'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'filter',
  'foreignObject', 'g', 'image', 'line', 'linearGradient', 'marker', 'mask', 'metadata',
  'mpath', 'path', 'pattern', 'polygon', 'polyline', 'radialGradient', 'rect', 'set',
  'stop', 'switch', 'symbol', 'text', 'textPath', 'tspan', 'use', 'view',
]);

/**
 * Attributes with no matching IDL property, or whose property name differs
 * enough that writing the attribute is the only correct move.
 */
export const MUST_USE_ATTRIBUTE = new Set([
  'class', 'style', 'for', 'role', 'is', 'list', 'form', 'download', 'target',
  'colspan', 'rowspan', 'datetime', 'novalidate', 'formnovalidate',
  'contenteditable', 'spellcheck', 'draggable', 'translate',
]);

/** Attributes whose presence alone is meaningful — removed entirely when falsy. */
export const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default',
  'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop',
  'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly',
  'required', 'reversed', 'selected',
]);

/** DOM property names that differ from their attribute spelling. */
export const ATTR_TO_PROP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  maxlength: 'maxLength',
  minlength: 'minLength',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin',
  datetime: 'dateTime',
  novalidate: 'noValidate',
  autocomplete: 'autocomplete',
  autofocus: 'autofocus',
};

/** Keyboard `.key` values addressable as `:keydown.enter` style modifiers. */
export const KEY_MODIFIERS: Record<string, string> = {
  enter: 'Enter',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  space: ' ',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  delete: 'Delete',
  backspace: 'Backspace',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

export const SYSTEM_MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'meta']);
export const EVENT_OPTION_MODIFIERS = new Set(['capture', 'once', 'passive']);
export const EVENT_GUARD_MODIFIERS = new Set(['stop', 'prevent', 'self']);

export function isComponentTag(tag: string): boolean {
  // PascalCase is unambiguous. A hyphen means custom element or component
  // selector; standard HTML has no hyphenated tags.
  if (/^[A-Z]/.test(tag)) return true;
  if (tag.includes('-')) return true;
  return false;
}

export function isKnownElement(tag: string): boolean {
  return HTML_TAGS.has(tag) || SVG_TAGS.has(tag.toLowerCase()) || SVG_TAGS.has(tag);
}

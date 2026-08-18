/**
 * Accessibility the compiler can prove from the template alone.
 *
 * Each rule is held to two things here, and the second is the one that decides
 * whether the rules survive contact with a real codebase: it fires on the case
 * it exists for, and it stays silent on the correct markup standing next to
 * it. `alt=""`, `aria-hidden` on an icon, `role="menuitem"` on a link and
 * `role="presentation"` on a decorative image are all correct, all one
 * character from something that is not, and all of them would be reported by a
 * rule written slightly too eagerly. A rule that fires on correct code teaches
 * people to switch the rules off, and takes the rest of them with it.
 *
 * Severity is asserted by which side of `compile` the finding comes out of:
 * certainly wrong throws, the way markup a parser would rebuild throws, and
 * usually wrong arrives in `warnings`.
 */

import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '@voltdev/compiler';

/** The messages this template warns with, in source order. */
function warnings(template: string): string[] {
  return compile(template).warnings.map((w) => w.message);
}

describe('an interactive listener on something no keyboard reaches', () => {
  it('reports a click handler on a plain element', () => {
    expect(warnings(`<div :click="select()">Pick</div>`)).toEqual([
      expect.stringContaining('`:click` on `<div>`, which no keyboard can reach'),
    ]);
  });

  it('names the remedy rather than the violation', () => {
    expect(warnings(`<span :keydown="go($event)">x</span>`)[0]).toContain(
      'Use `<button>` if it acts, `<a href>` if it navigates',
    );
  });

  it('stays quiet on elements that are already interactive', () => {
    expect(warnings(`<button :click="save()">Save</button>`)).toEqual([]);
    expect(warnings(`<a href="/next" :click="track($event)">Next</a>`)).toEqual([]);
    expect(warnings(`<summary :click="open()">More</summary>`)).toEqual([]);
    expect(warnings(`<label :click="focusInput()">Name</label>`)).toEqual([]);
  });

  it('stays quiet once the element says what it is', () => {
    expect(warnings(`<div role="button" tabindex="0" :click="select()">Pick</div>`)).toEqual([]);
  });

  it('stays quiet on events that are not how an element is operated', () => {
    // A splitter or a canvas listens on pointer events and is not a control;
    // reporting those is the false positive that gets the rules turned off.
    expect(warnings(`<div :pointerdown="startDrag($event)">handle</div>`)).toEqual([]);
    expect(warnings(`<div :mouseenter="preview()">card</div>`)).toEqual([]);
  });

  it('stays quiet when a spread may be carrying the role', () => {
    expect(warnings(`<div :spread="trigger.props()" :click="open()">Menu</div>`)).toEqual([]);
  });

  it('stays quiet when the role is bound rather than written', () => {
    expect(warnings(`<div :attr-role="role.get()" :click="select()">Pick</div>`)).toEqual([]);
  });
});

describe('an <img> that says nothing about itself', () => {
  it('rejects an image with no alt at all', () => {
    expect(() => compile(`<img src="/ada.png">`)).toThrow(/`<img>` with no `alt`/);
  });

  it('says that an empty alt is the answer for decoration', () => {
    expect(() => compile(`<img src="/ada.png">`)).toThrow(
      /an empty alt is an answer, a missing one is\n  silence/,
    );
  });

  it('accepts an empty alt, which is how an image says it is decoration', () => {
    expect(warnings(`<img src="/rule.png" alt="">`)).toEqual([]);
  });

  it('accepts every other way of naming an image', () => {
    expect(warnings(`<img src="/ada.png" alt="Ada Lovelace">`)).toEqual([]);
    expect(warnings(`<img src="/ada.png" :alt="person.name">`)).toEqual([]);
    expect(warnings(`<img src="/ada.png" aria-label="Ada Lovelace">`)).toEqual([]);
    expect(warnings(`<img src="/rule.png" aria-hidden="true">`)).toEqual([]);
    expect(warnings(`<img src="/rule.png" role="presentation">`)).toEqual([]);
  });

  it('accepts an image whose attributes arrive as a spread', () => {
    // What the spread carries is a runtime value, so the alt cannot be ruled
    // out — and this is the shape every image primitive is used through.
    expect(warnings(`<img :ref="image" :spread="avatar.imageProps()">`)).toEqual([]);
  });
});

describe('a <label> pointing at nothing', () => {
  it('reports a for that names no element in the template', () => {
    expect(warnings(`<label for="email">Email</label><input id="name">`)).toEqual([
      expect.stringContaining('`<label for>` points at `email`, which no element'),
    ]);
  });

  it('names the near miss when there is one', () => {
    expect(warnings(`<label for="emial">Email</label><input id="email">`)[0]).toContain(
      'Did you mean `email`?',
    );
  });

  it('offers wrapping the control as the remedy that needs no id', () => {
    expect(warnings(`<label for="email">Email</label><input id="name">`)[0]).toContain(
      'Wrapping the control in the `<label>` needs no id at all',
    );
  });

  it('accepts a for that resolves, wherever the control is written', () => {
    expect(warnings(`<label for="email">Email</label><input id="email">`)).toEqual([]);
    expect(warnings(`<input id="email"><label for="email">Email</label>`)).toEqual([]);
  });

  it('accepts an id sitting on a component tag', () => {
    expect(warnings(`<label for="email">Email</label><v-text-field id="email"></v-text-field>`))
      .toEqual([]);
  });

  it('accepts a label that wraps its control', () => {
    expect(warnings(`<label>Email <input type="email"></label>`)).toEqual([]);
  });

  it('goes quiet once the template computes an id, since any of them could match', () => {
    expect(warnings(`<label for="email">Email</label><input :attr-id="fieldId.get()">`))
      .toEqual([]);
  });
});

describe('aria-* the vocabulary does not contain', () => {
  it('rejects a misspelled attribute and names the one meant', () => {
    expect(() => compile(`<button aria-lable="Close">x</button>`)).toThrow(
      /`aria-lable` is not an ARIA attribute — did you mean `aria-label`\?/,
    );
    expect(() => compile(`<div aria-labeledby="t">a</div><h2 id="t">T</h2>`)).toThrow(
      /did you mean `aria-labelledby`\?/,
    );
  });

  it('rejects an invented attribute, and says where a private one belongs', () => {
    expect(() => compile(`<div aria-sparkle="yes">a</div>`)).toThrow(
      /Remove it, or write `data-sparkle` if it is your own/,
    );
  });

  it('rejects a misspelling that is bound rather than written', () => {
    // The name is knowable even where the value is not, and a binding hides a
    // typo exactly as well as an attribute does.
    expect(() => compile(`<div :aria-lable="label.get()">a</div>`)).toThrow(
      /did you mean `aria-label`\?/,
    );
  });

  it('accepts the whole real vocabulary, including the deprecated members', () => {
    expect(warnings(`<div aria-roledescription="slide" aria-grabbed="false">a</div>`)).toEqual([]);
  });
});

describe('an aria-* value outside its enumeration', () => {
  it('rejects a value that is not in the enum, and lists the enum', () => {
    expect(() => compile(`<div aria-live="loud">a</div>`)).toThrow(
      /Write `assertive`, `off` or `polite`/,
    );
  });

  it('rejects the near-miss spellings of true and false', () => {
    expect(() => compile(`<button aria-expanded="yes">More</button>`)).toThrow(
      /`aria-expanded` does not take `yes`/,
    );
  });

  it('rejects a word where a number belongs', () => {
    expect(() => compile(`<div role="heading" aria-level="two">T</div>`)).toThrow(
      /`aria-level` takes an integer, not `two`/,
    );
  });

  it('rejects one bad token in a list of good ones', () => {
    expect(() => compile(`<div aria-relevant="additions rubbish">a</div>`)).toThrow(
      /`aria-relevant` does not take `rubbish`/,
    );
  });

  it('accepts every value the enum really has', () => {
    expect(warnings(`<div aria-live="polite" aria-atomic="true">a</div>`)).toEqual([]);
    expect(warnings(`<a href="/here" aria-current="page">Here</a>`)).toEqual([]);
    expect(warnings(`<button aria-pressed="mixed">Bold</button>`)).toEqual([]);
    expect(warnings(`<div aria-relevant="additions text">a</div>`)).toEqual([]);
    expect(warnings(`<div role="heading" aria-level="2">T</div>`)).toEqual([]);
    expect(warnings(`<div role="slider" aria-valuenow="0.5" tabindex="0">a</div>`)).toEqual([]);
  });

  it('leaves a bound value alone, since only the runtime knows it', () => {
    expect(warnings(`<button :aria-expanded="open.get()">More</button>`)).toEqual([]);
  });
});

describe('a reference to an id no template defines', () => {
  it('reports an aria-labelledby that resolves to nothing', () => {
    expect(warnings(`<div role="dialog" aria-labelledby="heading">a</div>`)).toEqual([
      expect.stringContaining('`aria-labelledby` points at `heading`, which no element'),
    ]);
  });

  it('names the near miss when there is one', () => {
    expect(warnings(`<h2 id="title">T</h2><div role="dialog" aria-labelledby="titel">a</div>`)[0])
      .toContain('Did you mean `title`?');
  });

  it('reports each missing id in a list separately', () => {
    expect(warnings(`<h2 id="a">A</h2><div aria-describedby="a b c">x</div>`)).toHaveLength(2);
  });

  it('accepts references that resolve, in either order', () => {
    expect(warnings(`<h2 id="t">T</h2><div role="dialog" aria-labelledby="t">a</div>`)).toEqual([]);
    expect(warnings(`<div role="dialog" aria-labelledby="t">a</div><h2 id="t">T</h2>`)).toEqual([]);
    expect(warnings(`<p id="a">A</p><p id="b">B</p><div aria-describedby="a b">x</div>`)).toEqual([]);
  });

  it('goes quiet once the template computes an id', () => {
    // A row's id is built per item, so nothing here can say which ids exist.
    expect(
      warnings(`<div aria-labelledby="row-3">x</div><p :for="r in rows.get()" :key="r.id" :attr-id="'row-' + r.id">{ r.label }</p>`),
    ).toEqual([]);
  });
});

describe('a role that is not one', () => {
  it('rejects a misspelled role and names the one meant', () => {
    expect(() => compile(`<div role="buton" tabindex="0">Go</div>`)).toThrow(
      /`role="buton"` is not an ARIA role — did you mean `button`\?/,
    );
  });

  it('rejects an abstract role, which markup may never use', () => {
    expect(() => compile(`<div role="widget">a</div>`)).toThrow(/is not an ARIA role\./);
  });

  it('accepts a role from an ARIA module this compiler does not carry', () => {
    expect(warnings(`<p role="doc-subtitle">A history</p>`)).toEqual([]);
    expect(warnings(`<svg role="graphics-document"></svg>`)).toEqual([]);
  });

  it('accepts a fallback chain, which is read left to right', () => {
    expect(warnings(`<div role="doc-subtitle heading" aria-level="2">T</div>`)).toEqual([]);
  });
});

describe('a role that takes meaning away instead of adding it', () => {
  it('reports a button role on a link, which still navigates', () => {
    expect(warnings(`<a href="/save" role="button">Save</a>`)).toEqual([
      expect.stringContaining('`role="button"` on `<a>` replaces the link'),
    ]);
  });

  it('reports a link role on a button, which navigates nowhere', () => {
    expect(warnings(`<button role="link">Docs</button>`)).toEqual([
      expect.stringContaining('replaces the button'),
    ]);
  });

  it('reports a role that costs the page its landmarks', () => {
    expect(warnings(`<main role="region">a</main>`)[0]).toContain(
      'replaces the one `main` landmark a page gets',
    );
    expect(warnings(`<nav role="toolbar">a</nav>`)[0]).toContain(
      'replaces the navigation landmark',
    );
  });

  it('reports a role that costs the document an outline entry', () => {
    expect(warnings(`<h2 role="button" tabindex="0">Section</h2>`)[0]).toContain(
      'replaces the heading',
    );
  });

  it('rejects a presentational role on something a keyboard still focuses', () => {
    expect(() => compile(`<button role="presentation">x</button>`)).toThrow(
      /which a keyboard can still focus/,
    );
    expect(() => compile(`<a href="/x" role="none">x</a>`)).toThrow(
      /which a keyboard can still focus/,
    );
  });

  it('accepts a role that adds meaning the element did not have', () => {
    // Every one of these is the Authoring Practices' own pattern: the element
    // keeps doing what it did and gains a name for the part it plays.
    expect(warnings(`<a href="#panel" role="tab" aria-selected="true">One</a>`)).toEqual([]);
    expect(warnings(`<a href="/new" role="menuitem">New</a>`)).toEqual([]);
    expect(warnings(`<button role="switch" aria-checked="false">Wi-Fi</button>`)).toEqual([]);
    expect(warnings(`<button role="tab" aria-selected="false">Two</button>`)).toEqual([]);
    expect(warnings(`<button role="combobox" aria-expanded="false">Pick</button>`)).toEqual([]);
  });

  it('accepts a presentational role where it is the idiom', () => {
    expect(warnings(`<img src="/rule.png" alt="" role="presentation">`)).toEqual([]);
    // The tabs pattern: the list item carries nothing, the link is the tab.
    expect(warnings(`<ul role="tablist"><li role="presentation"><a href="#p" role="tab">One</a></li></ul>`))
      .toEqual([]);
  });

  it('accepts a role that only restates what the element already was', () => {
    expect(warnings(`<nav role="navigation">a</nav>`)).toEqual([]);
    expect(warnings(`<a href="/x" role="link">x</a>`)).toEqual([]);
  });
});

describe('a positive tabindex', () => {
  it('rejects it, because it reorders every page the component lands on', () => {
    expect(() => compile(`<div tabindex="1" role="button">Go</div>`)).toThrow(
      /`tabindex="1"` puts this element in front of the whole page/,
    );
  });

  it('accepts the two values that order nothing', () => {
    expect(warnings(`<div tabindex="0" role="button" :click="go()">Go</div>`)).toEqual([]);
    expect(warnings(`<div tabindex="-1" role="option">One</div>`)).toEqual([]);
  });
});

describe('nesting the ARIA content model forbids', () => {
  it('rejects a control inside a role whose contents become its name', () => {
    expect(() => compile(`<div role="option"><button :click="remove()">Remove</button></div>`))
      .toThrow(/`<button>` inside `role="option"`, which flattens everything in it to text/);
  });

  it('rejects a heading inside a button', () => {
    expect(() => compile(`<button :click="open()"><h2>Details</h2></button>`)).toThrow(
      /`<h2>` inside `<button>`, which flattens everything in it to text/,
    );
  });

  it('rejects a link inside a tab', () => {
    expect(() => compile(`<div role="tab"><a href="/docs">Docs</a></div>`)).toThrow(
      /flattens everything in it to text/,
    );
  });

  it('follows the nesting through a component, whose children still land inside', () => {
    expect(() => compile(`<div role="option"><v-badge><button>x</button></v-badge></div>`))
      .toThrow(/flattens everything in it to text/);
  });

  it('names making the two siblings as the remedy', () => {
    expect(() => compile(`<div role="option"><input type="checkbox"></div>`)).toThrow(
      /Make the two siblings — the control beside the `option`, not inside/,
    );
  });

  it('accepts the content these roles are built from', () => {
    expect(warnings(`<button :click="save()"><img src="/save.svg" alt=""><span>Save</span></button>`))
      .toEqual([]);
    expect(warnings(`<button><span aria-hidden="true">x</span> Close</button>`)).toEqual([]);
    expect(warnings(`<div role="option"><span class="badge">3</span> Ada</div>`)).toEqual([]);
  });

  it('accepts a heading inside a link, which does not flatten its contents', () => {
    expect(warnings(`<a href="/post"><h2>Title</h2><p>Summary</p></a>`)).toEqual([]);
  });

  it('accepts controls inside a role that owns them', () => {
    expect(warnings(`<div role="listbox"><div role="option" tabindex="-1">a</div></div>`))
      .toEqual([]);
    expect(warnings(`<div role="toolbar"><button>a</button><button>b</button></div>`)).toEqual([]);
  });

  it('accepts a component inside, because its root element is unknowable here', () => {
    expect(warnings(`<button :click="save()"><v-icon name="save"></v-icon> Save</button>`))
      .toEqual([]);
  });

  it('leaves a portalled control to the container it lands in', () => {
    expect(warnings(`<button :click="open()">Open<span :portal><a href="/x">go</a></span></button>`))
      .toEqual([]);
  });
});

describe('where a finding points', () => {
  it('names the file and the line an error is on', () => {
    expect(() =>
      compile(`<div>\n  <img src="/ada.png">\n</div>`, { filename: 'src/card.html' }),
    ).toThrow(/src\/card\.html:2:3/);
  });

  it('gives a warning the same line an error would print', () => {
    const [warning] = compile(`<div>\n  <p :click="pick()">a</p>\n</div>`, {
      filename: 'src/card.html',
    }).warnings;
    expect(formatDiagnostic(warning!)).toMatch(
      /^\[volt:compiler\] `:click` on `<p>`.*\(src\/card\.html:2:6\)$/s,
    );
  });
});

# Pending review

Five components written by an agent run that hit its limit before the review
pass could run, and before four of them had any tests at all.

| | source | tests |
| --- | --- | --- |
| listbox | yes | yes, and two of them contradict each other |
| combobox | yes | none |
| tree | yes | none |
| inputs | yes | none |
| slider + upload | yes | none |

They are out of `src/` so that nothing imports them and no test reports them as
passing. They typecheck and they are probably largely right — this is not a
judgement on the code, only on what has been verified about it.

The listbox question to settle first: one test has a plain `ArrowDown` preserve
the anchor so a later `Shift+Space` can range from the last *click*, and
another has a plain `Home` reset it so a later `Shift+ArrowDown` ranges from
there. Both cannot hold. The APG says Shift+Space "selects contiguous items
from the most recently selected item to the focused item" and that Shift+Arrow
*toggles* rather than extends, which matches neither test — so the model needs
deciding before either is treated as correct.

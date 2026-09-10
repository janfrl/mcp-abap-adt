# The tools in detail

The README lists every tool in one table. This page holds what is worth knowing about the tools that do more than fetch one object: the SQL dialect `ExecuteQuery` speaks, and how the three checking tools interpret what SAP returns.

## `ExecuteQuery` and `GetTableContents`

`ExecuteQuery` runs a single ABAP SQL SELECT and returns CSV. Prefer it over `GetTableContents` whenever only part of a table is needed — projecting and filtering is what keeps an answer small:

```
SELECT carrid, connid FROM sflight WHERE carrid = 'LH'
SELECT COUNT(*) AS cnt FROM t000
```

Dialect notes, since this is ABAP SQL and not the SQL you may expect: exactly one SELECT, no trailing semicolon, `ASCENDING`/`DESCENDING` instead of `ASC`/`DESC`, and no `LIMIT` clause — use the `maxRows` argument, which defaults to 100 and is capped at 5000. Joins with the tilde notation (`h~field`) work.

Every result ends with the database execution time SAP reports, so a slow answer can be told apart from a slow network. A single heavy query can be given more time with `timeoutMs` on the call (up to 10 minutes); a generally slow system gets a higher `"timeoutMs"` in its configuration entry instead.

Nothing here can write — SAP itself turns anything but a query into a syntax error, and the server checks again on top. Every query runs under the SAP authorisations of the configured user, which remains the real boundary on what can be read. `"allowFreeSql": false` forbids ad-hoc queries per system, with a caveat worth reading first: [the security model](security.md#read-only-by-design) explains why that setting makes a model read more data, not less.

## `CheckSyntax`

`CheckSyntax` runs SAP's own non-activating check — the one the ABAP editor runs on every keystroke — against source text you pass in. What gets checked is that text, never what the system currently stores, and nothing is saved or activated.

The object you name only lends context: its kind, its includes, its class hierarchy. **It does not have to exist.** SAP checks the supplied text either way, so brand-new code can be validated without first finding a real object to attach it to — which is the more useful half for anything that generates code. POST is required because ADT expects the source in the request body, exactly as `ExecuteQuery` already POSTs a read-only SELECT.

SAP reports the first syntax error it hits and stops, as the editor does; warnings from the same run are listed alongside.

## `GetWhereUsed`

`GetWhereUsed` runs the same lookup as Eclipse ADT's Ctrl+Shift+H. Two things about the answer are worth knowing, because SAP's raw response is misleading:

- **Only real usages are listed.** SAP flattens a tree into one list, in which packages and function groups appear as grouping nodes for the hits beneath them. They are not usages, and the count of dropped nodes is reported so the filter can be checked.
- **The total is always named, even when the list is cut.** A widely used standard object can have hundreds of usages, so `max_results` defaults to 100. A header line states the real total, so a shortened answer can never be mistaken for a short one.

A hit inside a method carries its type in the URI fragment rather than on the object element; the server reads it from there, so method-level usages come back typed like every other.

## `GetAtcFindings`

`GetAtcFindings` runs the ABAP Test Cockpit against one object and returns its findings with priority, line, the sub-object they sit in, the check that fired and its message. That is a different question from `CheckSyntax`: syntax says whether code compiles, ATC says whether it obeys the rules this system has decided to enforce — which a model cannot know from training data.

Which rules those are depends entirely on the **check variant**. There is no universal default, so `check_variant` is optional and falls back to the variant the system itself has configured (`systemCheckVariant` in the ATC customizing), exactly as ADT does for "Run ABAP Test Cockpit".

A variant the system does not offer is **rejected**, with the names it does offer, rather than run. That matters more than it sounds: SAP does not refuse an unusable variant but silently runs its own default instead, and nothing in the response says which variant executed — so without the check an answer could name a variant that never ran. [The security model](security.md#why-the-check-variant-is-validated-first) has the measurements behind that.

Three outcomes are deliberately kept apart, because conflating them is how a model concludes that unchecked code is fine:

- **Findings** — listed per object, with `[prio 1]` the most severe.
- **No findings** — the object was checked and nothing fired.
- **Not checked** — ATC returned no result for it at all. The name may not exist, or the object lies outside the variant's scope; SAP standard code usually does. This is reported as its own answer, never as "no findings".

A run that did not complete is announced on the first line as a tool failure, ahead of any count, and findings from the checks that did run are still reported below it.

Two limits worth knowing: ATC generally only has rules for custom code, so SAP standard objects tend to come back with nothing; and `max_findings` is enforced by this server, because the `maximumVerdicts` that ADT sends was observed not to cap anything.

Unlike every other tool, this one leaves something behind on the server — an ATC worklist that stays valid for ten days and is then removed by ATC housekeeping. [The security model](security.md#the-one-tool-that-leaves-something-behind) sets out what that is and why it still counts as read-only.
